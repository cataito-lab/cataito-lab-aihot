import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type Client, type InStatement } from "@libsql/client";
import type { SourceDef } from "./types";

let client: Client | null = null;

export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL || "file:./data/local.db";
    if (url.startsWith("file:")) {
      const filePath = url.slice("file:".length);
      mkdirSync(dirname(filePath), { recursive: true });
    }
    client = createClient({
      url,
      authToken: process.env.TURSO_AUTH_TOKEN || undefined,
    });
  }
  return client;
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    lang TEXT NOT NULL,
    site_url TEXT NOT NULL,
    feed_url TEXT,
    fetcher TEXT NOT NULL DEFAULT 'rss',
    dedicated INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    note TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES sources(id),
    title TEXT NOT NULL,
    title_zh TEXT,
    url TEXT NOT NULL UNIQUE,
    summary TEXT,
    author TEXT,
    published_at TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    translated INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_source ON articles (source_id, published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS fetch_logs (
    run_id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    inserted INTEGER DEFAULT 0,
    total_seen INTEGER DEFAULT 0,
    failed_feeds TEXT,
    ok INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS title_translations (
    title TEXT PRIMARY KEY,
    title_zh TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
];

const FTS_TRIGRAM_DDL = `CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title, title_zh, article_id UNINDEXED, tokenize='trigram'
)`;

const TRIGGER_DDLS = [
  `CREATE TRIGGER IF NOT EXISTS articles_fts_ai AFTER INSERT ON articles BEGIN
    INSERT INTO articles_fts(title, title_zh, article_id)
    VALUES (new.title, COALESCE(new.title_zh, ''), new.id);
  END`,
  `CREATE TRIGGER IF NOT EXISTS articles_fts_ad AFTER DELETE ON articles BEGIN
    DELETE FROM articles_fts WHERE article_id = old.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS articles_fts_au AFTER UPDATE OF title, title_zh ON articles BEGIN
    DELETE FROM articles_fts WHERE article_id = old.id;
    INSERT INTO articles_fts(title, title_zh, article_id)
    VALUES (new.title, COALESCE(new.title_zh, ''), new.id);
  END`,
];

async function migrateFts(): Promise<void> {
  const rs = await getDb().execute({
    sql: `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'articles_fts'`,
    args: [],
  });
  const existingSql = rs.rows[0] ? String(rs.rows[0].sql) : null;
  if (existingSql !== null && existingSql.includes("tokenize='trigram'")) return;
  if (existingSql !== null) {
    await getDb().execute({ sql: `DROP TRIGGER IF EXISTS articles_fts_ai`, args: [] });
    await getDb().execute({ sql: `DROP TRIGGER IF EXISTS articles_fts_ad`, args: [] });
    await getDb().execute({ sql: `DROP TRIGGER IF EXISTS articles_fts_au`, args: [] });
    await getDb().execute({ sql: `DROP TABLE IF EXISTS articles_fts`, args: [] });
  }
  await getDb().execute({ sql: FTS_TRIGRAM_DDL, args: [] });
  await getDb().execute({
    sql: `INSERT INTO articles_fts(title, title_zh, article_id)
          SELECT title, COALESCE(title_zh, ''), id FROM articles`,
    args: [],
  });
}

async function ensureColumn(table: string, column: string, ddl: string): Promise<void> {
  const rs = await getDb().execute({ sql: `PRAGMA table_info(${table})`, args: [] });
  const exists = rs.rows.some((row) => String(row.name) === column);
  if (!exists) {
    await getDb().execute({ sql: `ALTER TABLE ${table} ADD COLUMN ${ddl}`, args: [] });
  }
}

export async function ensureSchema(): Promise<void> {
  await getDb().batch(
    SCHEMA_STATEMENTS.map((stmt) => ({ sql: stmt, args: [] })),
    "write",
  );
  await ensureColumn("articles", "summarized_at", "summarized_at TEXT");
  await migrateFts();
  for (const ddl of TRIGGER_DDLS) {
    await getDb().execute({ sql: ddl, args: [] });
  }
}

export async function seedSources(sources: SourceDef[]): Promise<void> {
  const now = new Date().toISOString();
  const statements: InStatement[] = sources.map((s) => ({
    sql: `INSERT INTO sources (id, name, category, lang, site_url, feed_url, fetcher, dedicated, enabled, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            lang = excluded.lang,
            site_url = excluded.site_url,
            feed_url = excluded.feed_url,
            fetcher = excluded.fetcher,
            dedicated = excluded.dedicated,
            enabled = excluded.enabled,
            note = excluded.note`,
    args: [
      s.id,
      s.name,
      s.category,
      s.lang,
      s.siteUrl,
      s.feedUrl,
      s.fetcher,
      s.dedicated ? 1 : 0,
      s.enabled ? 1 : 0,
      s.note ?? null,
      now,
    ],
  }));
  await getDb().batch(statements, "write");
}

export async function filterNewIds(ids: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const placeholders = chunk.map(() => "?").join(",");
    const rs = await getDb().execute({
      sql: `SELECT id FROM articles WHERE id IN (${placeholders})`,
      args: chunk,
    });
    for (const row of rs.rows) existing.add(String(row.id));
  }
  return existing;
}

export interface NewArticleRow {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  author?: string;
  publishedAt: string;
}

export async function insertArticles(rows: NewArticleRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date().toISOString();
  const statements: InStatement[] = rows.map((r) => ({
    sql: `INSERT INTO articles (id, source_id, title, url, author, published_at, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [r.id, r.sourceId, r.title, r.url, r.author ?? null, r.publishedAt, now],
  }));
  let inserted = 0;
  for (let i = 0; i < statements.length; i += 50) {
    const results = await getDb().batch(statements.slice(i, i + 50), "write");
    for (const rs of results) inserted += Number(rs.rowsAffected);
  }
  return inserted;
}

export async function startRun(runId: string): Promise<void> {
  await getDb().execute({
    sql: `INSERT OR IGNORE INTO fetch_logs (run_id, started_at) VALUES (?, ?)`,
    args: [runId, new Date().toISOString()],
  });
}

export async function getTitleTranslations(titles: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 100) {
    const chunk = titles.slice(i, i + 100);
    const placeholders = chunk.map(() => "?").join(",");
    const rs = await getDb().execute({
      sql: `SELECT title, title_zh FROM title_translations WHERE title IN (${placeholders})`,
      args: chunk,
    });
    for (const row of rs.rows) map.set(String(row.title), String(row.title_zh));
  }
  return map;
}

export async function saveTitleTranslations(
  pairs: { title: string; titleZh: string }[],
): Promise<void> {
  if (pairs.length === 0) return;
  const now = new Date().toISOString();
  const statements: InStatement[] = pairs.map((p) => ({
    sql: `INSERT INTO title_translations (title, title_zh, created_at) VALUES (?, ?, ?)
          ON CONFLICT(title) DO NOTHING`,
    args: [p.title, p.titleZh, now],
  }));
  await getDb().batch(statements, "write");
}

export async function applyTranslationUpdates(
  updates: { id: string; titleZh: string }[],
): Promise<void> {
  if (updates.length === 0) return;
  const statements: InStatement[] = updates.map((u) => ({
    sql: `UPDATE articles SET title_zh = ?, translated = 1 WHERE id = ?`,
    args: [u.titleZh, u.id],
  }));
  await getDb().batch(statements, "write");
}

export interface UntranslatedRow {
  id: string;
  title: string;
}

export async function getUntranslated(limit: number): Promise<UntranslatedRow[]> {
  const rs = await getDb().execute({
    sql: `SELECT a.id, a.title FROM articles a
          JOIN sources s ON s.id = a.source_id
          WHERE s.lang = 'en' AND a.translated = 0
          ORDER BY a.published_at DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((row) => ({ id: String(row.id), title: String(row.title) }));
}

export interface SummarizableArticleRow {
  id: string;
  title: string;
  titleZh: string | null;
  sourceName: string;
}

export async function getRecentWithoutSummary(
  windowHours: number,
  limit: number,
): Promise<SummarizableArticleRow[]> {
  const cutoff = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const rs = await getDb().execute({
    sql: `SELECT a.id, a.title, a.title_zh, s.name AS source_name
          FROM articles a JOIN sources s ON s.id = a.source_id
          WHERE a.summary IS NULL AND a.summarized_at IS NULL AND a.published_at >= ?
          ORDER BY a.published_at DESC LIMIT ?`,
    args: [cutoff, limit],
  });
  return rs.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    titleZh: row.title_zh == null ? null : String(row.title_zh),
    sourceName: String(row.source_name),
  }));
}

export async function countSummariesToday(): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const rs = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM articles
          WHERE summarized_at IS NOT NULL AND summarized_at >= ?`,
    args: [dayStart.toISOString()],
  });
  return Number(rs.rows[0]?.n ?? 0);
}

export async function markSummarized(
  id: string,
  summary: string | null,
  hasSummary: boolean,
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE articles SET summary = ?, summarized_at = ? WHERE id = ?`,
    args: [hasSummary ? summary : null, new Date().toISOString(), id],
  });
}

export async function finishRun(
  runId: string,
  stats: { inserted: number; totalSeen: number; failedFeeds: string[]; ok: boolean },
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE fetch_logs
          SET finished_at = ?, inserted = ?, total_seen = ?, failed_feeds = ?, ok = ?
          WHERE run_id = ?`,
    args: [
      new Date().toISOString(),
      stats.inserted,
      stats.totalSeen,
      JSON.stringify(stats.failedFeeds),
      stats.ok ? 1 : 0,
      runId,
    ],
  });
}
