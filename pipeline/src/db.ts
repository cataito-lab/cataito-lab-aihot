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
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    event_key TEXT,
    title TEXT,
    title_zh TEXT,
    summary TEXT,
    summary_en TEXT,
    summary_ja TEXT,
    summary_es TEXT,
    summary_fr TEXT,
    peak_score INTEGER,
    source_count INTEGER NOT NULL DEFAULT 1,
    first_seen TEXT,
    last_seen TEXT,
    updated_at TEXT,
    synthesized INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_key ON events (event_key)`,
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
  await ensureColumn("articles", "source_timezone", "source_timezone TEXT DEFAULT 'UTC'");
  await ensureColumn("articles", "estimated", "estimated INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("articles", "summary_en", "summary_en TEXT");
  await ensureColumn("articles", "summary_ja", "summary_ja TEXT");
  await ensureColumn("articles", "summary_es", "summary_es TEXT");
  await ensureColumn("articles", "summary_fr", "summary_fr TEXT");
  await ensureColumn("fetch_logs", "translate_ok", "translate_ok INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("fetch_logs", "translate_failed", "translate_failed INTEGER NOT NULL DEFAULT 0");
  // Summarize v3：一段式摘要 + 要点 + 行业影响 + 三维评分
  await ensureColumn("articles", "article_content", "article_content TEXT");
  await ensureColumn("articles", "key_points", "key_points TEXT");
  await ensureColumn("articles", "industry_impact", "industry_impact TEXT");
  await ensureColumn("articles", "score_relevance", "score_relevance INTEGER");
  await ensureColumn("articles", "score_quality", "score_quality INTEGER");
  await ensureColumn("articles", "score_impact", "score_impact INTEGER");
  await ensureColumn("articles", "score_final", "score_final INTEGER");
  await ensureColumn("articles", "event_key", "event_key TEXT");
  await ensureColumn("articles", "entities", "entities TEXT");
  await ensureColumn("articles", "key_change", "key_change TEXT");
  await ensureColumn("articles", "key_change_en", "key_change_en TEXT");
  await ensureColumn("articles", "why_it_matters", "why_it_matters TEXT");
  await ensureColumn("articles", "why_it_matters_en", "why_it_matters_en TEXT");
  await ensureColumn("articles", "forward_signal", "forward_signal TEXT");
  await ensureColumn("articles", "forward_signal_en", "forward_signal_en TEXT");
  await ensureColumn("articles", "impact", "impact TEXT");
  await ensureColumn("articles", "impact_en", "impact_en TEXT");
  // 洞察字段的 ja/es/fr 翻译列（由独立翻译任务补全，消除非中英界面的英文混杂）
  await ensureColumn("articles", "key_change_ja", "key_change_ja TEXT");
  await ensureColumn("articles", "key_change_es", "key_change_es TEXT");
  await ensureColumn("articles", "key_change_fr", "key_change_fr TEXT");
  await ensureColumn("articles", "forward_signal_ja", "forward_signal_ja TEXT");
  await ensureColumn("articles", "forward_signal_es", "forward_signal_es TEXT");
  await ensureColumn("articles", "forward_signal_fr", "forward_signal_fr TEXT");
  await ensureColumn("articles", "impact_ja", "impact_ja TEXT");
  await ensureColumn("articles", "impact_es", "impact_es TEXT");
  await ensureColumn("articles", "impact_fr", "impact_fr TEXT");
  await ensureColumn("articles", "title_ja", "title_ja TEXT");
  await ensureColumn("articles", "title_es", "title_es TEXT");
  await ensureColumn("articles", "title_fr", "title_fr TEXT");
  await ensureColumn("articles", "category", "category TEXT");
  await ensureColumn("articles", "category_en", "category_en TEXT");
  await ensureColumn("articles", "importance_score", "importance_score INTEGER");
  await ensureColumn("articles", "event_id", "event_id TEXT");
  // Insight Engine Phase 1（2026-09-02 起）：五板块推理链 + 洞察等级 + 主题分类 + Fact/Inference/Speculation
  await ensureColumn("articles", "insight_level", "insight_level INTEGER NOT NULL DEFAULT 1");
  await ensureColumn("articles", "insight_reviewed", "insight_reviewed INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("articles", "insight_pass", "insight_pass INTEGER");
  await ensureColumn("articles", "insight_review_score_info_gain", "insight_review_score_info_gain INTEGER");
  await ensureColumn("articles", "insight_review_score_evidence", "insight_review_score_evidence INTEGER");
  await ensureColumn("articles", "insight_review_score_specificity", "insight_review_score_specificity INTEGER");
  await ensureColumn("articles", "insight_review_score_interpretation", "insight_review_score_interpretation INTEGER");
  await ensureColumn("articles", "fact", "fact TEXT");
  await ensureColumn("articles", "inference", "inference TEXT");
  await ensureColumn("articles", "speculation", "speculation TEXT");
  await ensureColumn("articles", "fact_sources", "fact_sources TEXT");
  await ensureColumn("articles", "topic_category", "topic_category TEXT");
  await getDb().execute("CREATE INDEX IF NOT EXISTS idx_articles_insight_level ON articles (insight_level)");
  await getDb().execute("CREATE INDEX IF NOT EXISTS idx_articles_topic_category ON articles (topic_category)");
  // Phase 2（2026-09-04）：审核评分索引，供后续按 pass 状态筛选高质量洞察
  await getDb().execute("CREATE INDEX IF NOT EXISTS idx_articles_insight_pass ON articles (insight_pass)");
  await getDb().execute("CREATE INDEX IF NOT EXISTS idx_articles_insight_reviewed ON articles (insight_reviewed)");
  await getDb().execute("CREATE INDEX IF NOT EXISTS idx_articles_event ON articles (event_id)");
  await ensureColumn("sources", "authority", "authority INTEGER");
  await ensureColumn("sources", "fail_streak", "fail_streak INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("sources", "next_attempt_at", "next_attempt_at TEXT");
  await migrateFts();
  for (const ddl of TRIGGER_DDLS) {
    await getDb().execute({ sql: ddl, args: [] });
  }
}

export async function seedSources(sources: SourceDef[]): Promise<void> {
  const now = new Date().toISOString();
  const statements: InStatement[] = sources.map((s) => ({
    sql: `INSERT INTO sources (id, name, category, lang, site_url, feed_url, fetcher, dedicated, enabled, note, authority, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            category = excluded.category,
            lang = excluded.lang,
            site_url = excluded.site_url,
            feed_url = excluded.feed_url,
            fetcher = excluded.fetcher,
            dedicated = excluded.dedicated,
            enabled = excluded.enabled,
            note = excluded.note,
            authority = excluded.authority`,
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
      s.authority ?? 60,
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
  sourceTimezone?: string;
  estimated?: boolean;
  articleContent?: string;
}

export async function insertArticles(rows: NewArticleRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date().toISOString();
  const statements: InStatement[] = rows.map((r) => ({
    sql: `INSERT INTO articles (id, source_id, title, url, author, published_at, fetched_at, source_timezone, estimated, article_content)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      r.id,
      r.sourceId,
      r.title,
      r.url,
      // 防御：author 若被上游解析成对象/数组等非字符串类型，一律置 null（SQLite 拒绝绑定其他类型）
      typeof r.author === "string" ? r.author : null,
      r.publishedAt,
      now,
      r.sourceTimezone ?? "UTC",
      r.estimated ? 1 : 0,
      r.articleContent ?? null,
    ],
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
  content: string | null;
  authority: number;
}

function textOrNull(v: unknown): string | null {
  return v == null ? null : String(v);
}

// libSQL hrana 只接受 string | number | null；undefined / 非有限数字 / 对象都会抛
// "Unsupported type of value"。这里统一兜底，避免单字段缺失导致整批写入失败。
function dbVal(v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

export async function getRecentWithoutSummary(
  windowHours: number,
  limit: number,
): Promise<SummarizableArticleRow[]> {
  const cutoff = new Date(Date.now() - windowHours * 3_600_000).toISOString();
  const rs = await getDb().execute({
    sql: `SELECT a.id, a.title, a.title_zh, s.name AS source_name,
                 a.article_content, COALESCE(s.authority, 60) AS authority
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
    content: textOrNull(row.article_content),
    authority: Number(row.authority ?? 60),
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

export interface SummarizeResultV3 {
  summary: string | null;
  summaryEn: string | null;
  keyChange: string | null;
  keyChangeEn: string | null;
  whyItMatters: string | null;
  whyItMattersEn: string | null;
  forwardSignal: string | null;
  forwardSignalEn: string | null;
  impact: string | null; // JSON: {audience,description}[]
  impactEn: string | null; // JSON: {audience,description}[]
  category: string | null; // JSON: string[]
  categoryEn: string | null; // JSON: string[]
  relevance: number | null;
  quality: number | null;
  impactScore: number | null;
  importanceScore: number | null;
  final: number | null;
  eventKey: string | null;
  entities: string[] | null;
  // Insight Engine（Phase 1，2026-09-02 起）
  insightLevel?: number | null;        // L0–L4
  insightReviewed?: number | null;     // 0/1
  insightPass?: number | null;         // null=未审核, 0=FAIL, 1=PASS
  insightReviewScoreInfoGain?: number | null;     // 审核 4 维
  insightReviewScoreEvidence?: number | null;
  insightReviewScoreSpecificity?: number | null;
  insightReviewScoreInterpretation?: number | null;
  fact?: string[] | null;              // JSON: string[]
  inference?: string[] | null;
  speculation?: string[] | null;
  factSources?: string[] | null;
  topicCategory?: string[] | null;     // JSON: string[]，与 category(Source) 正交
}

export async function markSummarized(
  id: string,
  result: SummarizeResultV3,
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE articles SET
            summary = ?, summary_en = ?,
            key_change = ?, key_change_en = ?,
            why_it_matters = ?, why_it_matters_en = ?,
            forward_signal = ?, forward_signal_en = ?,
            impact = ?, impact_en = ?,
            category = ?, category_en = ?,
            score_relevance = ?, score_quality = ?, score_impact = ?, score_final = ?,
            importance_score = ?,
            event_key = ?, entities = ?,
            insight_level = ?, insight_reviewed = ?, insight_pass = ?,
            insight_review_score_info_gain = ?, insight_review_score_evidence = ?,
            insight_review_score_specificity = ?, insight_review_score_interpretation = ?,
            fact = ?, inference = ?, speculation = ?, fact_sources = ?,
            topic_category = ?,
            summarized_at = ?
          WHERE id = ?`,
    args: [
      dbVal(result.summary),
      dbVal(result.summaryEn),
      dbVal(result.keyChange),
      dbVal(result.keyChangeEn),
      dbVal(result.whyItMatters),
      dbVal(result.whyItMattersEn),
      dbVal(result.forwardSignal),
      dbVal(result.forwardSignalEn),
      dbVal(result.impact),
      dbVal(result.impactEn),
      dbVal(result.category),
      dbVal(result.categoryEn),
      dbVal(result.relevance),
      dbVal(result.quality),
      dbVal(result.impactScore),
      dbVal(result.final),
      dbVal(result.importanceScore),
      dbVal(result.eventKey),
      result.entities ? JSON.stringify(result.entities) : null,
      dbVal(result.insightLevel ?? 1),
      dbVal(result.insightReviewed ?? 0),
      dbVal(result.insightPass),
      dbVal(result.insightReviewScoreInfoGain),
      dbVal(result.insightReviewScoreEvidence),
      dbVal(result.insightReviewScoreSpecificity),
      dbVal(result.insightReviewScoreInterpretation),
      result.fact ? JSON.stringify(result.fact) : null,
      result.inference ? JSON.stringify(result.inference) : null,
      result.speculation ? JSON.stringify(result.speculation) : null,
      result.factSources ? JSON.stringify(result.factSources) : null,
      result.topicCategory ? JSON.stringify(result.topicCategory) : null,
      new Date().toISOString(),
      id,
    ],
  });
}

// 回填用：只更新事件的 event_key/entities，并清空 event_id 以便 clusterEvents 重新聚类。
// 不触碰 summary/评分，避免覆盖既有摘要。
export async function setEventKey(
  id: string,
  eventKey: string | null,
  entities: string[] | null,
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE articles SET event_key = ?, entities = ?, event_id = NULL WHERE id = ?`,
    args: [dbVal(eventKey), entities ? JSON.stringify(entities) : null, id],
  });
}

// ---- 事件聚类 ----

export interface EventRow {
  id: string;
  eventKey: string | null;
  title: string | null;
  titleZh: string | null;
  summary: string | null;
  summaryEn: string | null;
  peakScore: number | null;
  sourceCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  updatedAt: string | null;
  synthesized: number;
}

export async function findEventByKey(eventKey: string): Promise<EventRow | null> {
  const rs = await getDb().execute({
    sql: `SELECT id, event_key, title, title_zh, summary, summary_en, peak_score, source_count, first_seen, last_seen, updated_at, synthesized FROM events WHERE event_key = ? LIMIT 1`,
    args: [eventKey],
  });
  const r = rs.rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    eventKey: r.event_key == null ? null : String(r.event_key),
    title: r.title == null ? null : String(r.title),
    titleZh: r.title_zh == null ? null : String(r.title_zh),
    summary: r.summary == null ? null : String(r.summary),
    summaryEn: r.summary_en == null ? null : String(r.summary_en),
    peakScore: r.peak_score == null ? null : Number(r.peak_score),
    sourceCount: Number(r.source_count ?? 1),
    firstSeen: r.first_seen == null ? null : String(r.first_seen),
    lastSeen: r.last_seen == null ? null : String(r.last_seen),
    updatedAt: r.updated_at == null ? null : String(r.updated_at),
    synthesized: Number(r.synthesized ?? 0),
  };
}

export async function createEvent(params: {
  id: string;
  eventKey: string;
  title: string;
  titleZh: string | null;
  peakScore: number | null;
  firstSeen: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await getDb().execute({
    sql: `INSERT INTO events (id, event_key, title, title_zh, peak_score, source_count, first_seen, last_seen, updated_at, synthesized)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 0)`,
    args: [params.id, params.eventKey, params.title, params.titleZh, params.peakScore, params.firstSeen, params.firstSeen, now],
  });
}

export async function assignArticleEvent(articleId: string, eventId: string): Promise<void> {
  await getDb().execute({
    sql: `UPDATE articles SET event_id = ? WHERE id = ?`,
    args: [eventId, articleId],
  });
}

export async function updateEventStats(
  eventId: string,
  params: { peakScore: number | null; sourceCount: number; lastSeen: string; title: string; titleZh: string | null },
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE events SET peak_score = ?, source_count = ?, last_seen = ?, title = ?, title_zh = ?, updated_at = ? WHERE id = ?`,
    args: [params.peakScore, params.sourceCount, params.lastSeen, params.title, params.titleZh, new Date().toISOString(), eventId],
  });
}

export async function getEventMembers(
  eventId: string,
): Promise<Array<{ id: string; title: string; titleZh: string | null; summary: string | null; sourceId: string; scoreFinal: number | null; url: string; publishedAt: string }>> {
  const rs = await getDb().execute({
    sql: `SELECT id, title, title_zh, summary, source_id, score_final, url, published_at FROM articles WHERE event_id = ? ORDER BY COALESCE(score_final, -1) DESC, published_at DESC`,
    args: [eventId],
  });
  return rs.rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    titleZh: r.title_zh == null ? null : String(r.title_zh),
    summary: r.summary == null ? null : String(r.summary),
    sourceId: String(r.source_id),
    scoreFinal: r.score_final == null ? null : Number(r.score_final),
    url: String(r.url),
    publishedAt: String(r.published_at),
  }));
}

export async function getUnsynthesizedEvents(limit: number): Promise<Array<{ id: string; eventKey: string | null; sourceCount: number }>> {
  const rs = await getDb().execute({
    sql: `SELECT id, event_key, source_count FROM events WHERE synthesized = 0 AND source_count >= 2 ORDER BY updated_at DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => ({
    id: String(r.id),
    eventKey: r.event_key == null ? null : String(r.event_key),
    sourceCount: Number(r.source_count ?? 1),
  }));
}

export async function saveEventSynthesis(
  eventId: string,
  summaryZh: string | null,
  summaryEn: string | null,
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE events SET summary = ?, summary_en = ?, synthesized = 1, updated_at = ? WHERE id = ?`,
    args: [summaryZh, summaryEn, new Date().toISOString(), eventId],
  });
}

/** 本运行窗口内已摘要、尚未分配 event_id 的文章（用于聚类）；非事件项也会被取出并以自身 id 成组 */
export async function getUnclusteredArticles(windowHours: number): Promise<Array<{ id: string; eventKey: string | null; title: string; titleZh: string | null; scoreFinal: number | null; publishedAt: string }>> {
  const rs = await getDb().execute({
    sql: `SELECT id, event_key, title, title_zh, score_final, published_at FROM articles WHERE event_id IS NULL AND summary IS NOT NULL AND published_at >= ?`,
    args: [new Date(Date.now() - windowHours * 3_600_000).toISOString()],
  });
  return rs.rows.map((r) => ({
    id: String(r.id),
    eventKey: r.event_key == null ? null : String(r.event_key),
    title: String(r.title),
    titleZh: r.title_zh == null ? null : String(r.title_zh),
    scoreFinal: r.score_final == null ? null : Number(r.score_final),
    publishedAt: String(r.published_at),
  }));
}

/** 摘要目标语言 → 数据库列（zh 沿用 summary 主列，不在此列） */
export const SUMMARY_LANG_COLUMNS = {
  en: "summary_en",
  ja: "summary_ja",
  es: "summary_es",
  fr: "summary_fr",
} as const;

export type SummaryLang = keyof typeof SUMMARY_LANG_COLUMNS;

export interface SummaryTranslateRow {
  id: string;
  summary: string;
  missing: SummaryLang[];
}

export async function getPendingSummaryTranslations(
  limit: number,
): Promise<SummaryTranslateRow[]> {
  const rs = await getDb().execute({
    sql: `SELECT id, summary,
            summary_en IS NULL AS need_en,
            summary_ja IS NULL AS need_ja,
            summary_es IS NULL AS need_es,
            summary_fr IS NULL AS need_fr
          FROM articles
          WHERE summary IS NOT NULL
            AND (summary_en IS NULL OR summary_ja IS NULL OR summary_es IS NULL OR summary_fr IS NULL)
          ORDER BY published_at DESC LIMIT ?`,
    args: [limit],
  });
  const rows: SummaryTranslateRow[] = [];
  for (const row of rs.rows) {
    const missing: SummaryLang[] = [];
    if (Number(row.need_en) === 1) missing.push("en");
    if (Number(row.need_ja) === 1) missing.push("ja");
    if (Number(row.need_es) === 1) missing.push("es");
    if (Number(row.need_fr) === 1) missing.push("fr");
    if (missing.length > 0) {
      rows.push({ id: String(row.id), summary: String(row.summary), missing });
    }
  }
  return rows;
}

export async function applySummaryTranslationUpdates(
  updates: { id: string; lang: SummaryLang; text: string }[],
): Promise<void> {
  if (updates.length === 0) return;
  const byLang: Record<SummaryLang, { sql: string; args: (string | number)[] }[]> = {
    en: [], ja: [], es: [], fr: [],
  };
  for (const u of updates) {
    byLang[u.lang].push({
      sql: `UPDATE articles SET ${SUMMARY_LANG_COLUMNS[u.lang]} = ? WHERE id = ?`,
      args: [u.text, u.id],
    });
  }
  for (const lang of Object.keys(byLang) as SummaryLang[]) {
    const stmts = byLang[lang];
    for (let i = 0; i < stmts.length; i += 50) {
      await getDb().batch(stmts.slice(i, i + 50), "write");
    }
  }
}

// ---- 洞察字段多语言翻译（key_change / forward_signal / impact / why 的 ja/es/fr）----
// 与摘要翻译同理：主摘要只生成中英，这里用翻译通道补全其余三语，消除非中英界面的英文混杂。

export interface InsightTranslateConfig {
  field: "key_change" | "forward_signal" | "why_it_matters" | "impact";
  srcEn: string;
  srcZh: string;
  cols: { ja: string; es: string; fr: string };
}

export const INSIGHT_TRANSLATE_CONFIG: InsightTranslateConfig[] = [
  { field: "key_change", srcEn: "key_change_en", srcZh: "key_change", cols: { ja: "key_change_ja", es: "key_change_es", fr: "key_change_fr" } },
  { field: "forward_signal", srcEn: "forward_signal_en", srcZh: "forward_signal", cols: { ja: "forward_signal_ja", es: "forward_signal_es", fr: "forward_signal_fr" } },
  { field: "why_it_matters", srcEn: "why_it_matters_en", srcZh: "why_it_matters", cols: { ja: "why_ja", es: "why_es", fr: "why_fr" } },
  { field: "impact", srcEn: "impact_en", srcZh: "impact", cols: { ja: "impact_ja", es: "impact_es", fr: "impact_fr" } },
];

export type InsightLang = "ja" | "es" | "fr";

export interface InsightTranslateRow {
  id: string;
  fields: Record<string, { src: string | null; missing: InsightLang[] }>;
}

export interface InsightTranslationUpdate {
  id: string;
  field: string;
  lang: InsightLang;
  text: string;
}

export async function getPendingInsightTranslations(
  limit: number,
): Promise<InsightTranslateRow[]> {
  const selectParts: string[] = ["id"];
  const conditions: string[] = [];
  for (const c of INSIGHT_TRANSLATE_CONFIG) {
    selectParts.push(`COALESCE(${c.srcEn}, ${c.srcZh}) AS ${c.field}_src`);
    for (const lang of ["ja", "es", "fr"] as const) {
      selectParts.push(`${c.cols[lang]} IS NULL AS ${c.field}_need_${lang}`);
      conditions.push(`${c.cols[lang]} IS NULL`);
    }
  }
  const rs = await getDb().execute({
    sql: `SELECT ${selectParts.join(", ")} FROM articles
          WHERE ${conditions.join(" OR ")}
          ORDER BY published_at DESC LIMIT ?`,
    args: [limit],
  });
  const rows: InsightTranslateRow[] = [];
  for (const row of rs.rows) {
    const fields: Record<string, { src: string | null; missing: InsightLang[] }> = {};
    let hasAny = false;
    for (const c of INSIGHT_TRANSLATE_CONFIG) {
      const src = row[`${c.field}_src`] == null ? null : String(row[`${c.field}_src`]);
      const missing: InsightLang[] = [];
      for (const lang of ["ja", "es", "fr"] as const) {
        if (Number(row[`${c.field}_need_${lang}`]) === 1) missing.push(lang);
      }
      if (src && missing.length > 0) {
        fields[c.field] = { src, missing };
        hasAny = true;
      }
    }
    if (hasAny) rows.push({ id: String(row.id), fields });
  }
  return rows;
}

export async function applyInsightTranslationUpdates(
  updates: InsightTranslationUpdate[],
): Promise<void> {
  if (updates.length === 0) return;
  const colFor = (field: string, lang: InsightLang): string => {
    const c = INSIGHT_TRANSLATE_CONFIG.find((x) => x.field === field);
    if (!c) throw new Error(`unknown insight field ${field}`);
    return c.cols[lang];
  };
  const stmts = updates.map((u) => ({
    sql: `UPDATE articles SET ${colFor(u.field, u.lang)} = ? WHERE id = ?`,
    args: [u.text, u.id] as (string | number)[],
  }));
  for (let i = 0; i < stmts.length; i += 50) {
    await getDb().batch(stmts.slice(i, i + 50), "write");
  }
}

// ---- 标题多语言翻译（ja/es/fr）----
// 与摘要同理：标题只存原始语言 + title_zh，这里用翻译通道补全 ja/es/fr，消除非中英界面标题的英文/中文混杂。

export const TITLE_LANG_COLUMNS = {
  ja: "title_ja",
  es: "title_es",
  fr: "title_fr",
} as const;

export type TitleLang = keyof typeof TITLE_LANG_COLUMNS;

export interface TitleTranslateRow {
  id: string;
  title: string;
  missing: TitleLang[];
}

export async function getPendingTitleTranslations(
  limit: number,
): Promise<TitleTranslateRow[]> {
  const rs = await getDb().execute({
    sql: `SELECT id, title,
            title_ja IS NULL AS need_ja,
            title_es IS NULL AS need_es,
            title_fr IS NULL AS need_fr
          FROM articles
          WHERE title IS NOT NULL
            AND (title_ja IS NULL OR title_es IS NULL OR title_fr IS NULL)
          ORDER BY published_at DESC LIMIT ?`,
    args: [limit],
  });
  const rows: TitleTranslateRow[] = [];
  for (const row of rs.rows) {
    const missing: TitleLang[] = [];
    if (Number(row.need_ja) === 1) missing.push("ja");
    if (Number(row.need_es) === 1) missing.push("es");
    if (Number(row.need_fr) === 1) missing.push("fr");
    if (missing.length > 0) {
      rows.push({ id: String(row.id), title: String(row.title), missing });
    }
  }
  return rows;
}

export async function applyTitleTranslationUpdates(
  updates: { id: string; lang: TitleLang; text: string }[],
): Promise<void> {
  if (updates.length === 0) return;
  const byLang: Record<TitleLang, { sql: string; args: (string | number)[] }[]> = {
    ja: [], es: [], fr: [],
  };
  for (const u of updates) {
    byLang[u.lang].push({
      sql: `UPDATE articles SET ${TITLE_LANG_COLUMNS[u.lang]} = ? WHERE id = ?`,
      args: [u.text, u.id],
    });
  }
  for (const lang of Object.keys(byLang) as TitleLang[]) {
    const stmts = byLang[lang];
    for (let i = 0; i < stmts.length; i += 50) {
      await getDb().batch(stmts.slice(i, i + 50), "write");
    }
  }
}

export async function finishRun(
  runId: string,
  stats: {
    inserted: number;
    totalSeen: number;
    failedFeeds: string[];
    ok: boolean;
    translateOk?: number;
    translateFailed?: number;
  },
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE fetch_logs
          SET finished_at = ?, inserted = ?, total_seen = ?, failed_feeds = ?, ok = ?,
              translate_ok = COALESCE(?, translate_ok), translate_failed = COALESCE(?, translate_failed)
          WHERE run_id = ?`,
    args: [
      new Date().toISOString(),
      stats.inserted,
      stats.totalSeen,
      JSON.stringify(stats.failedFeeds),
      stats.ok ? 1 : 0,
      stats.translateOk ?? null,
      stats.translateFailed ?? null,
      runId,
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// C8：跨文章检索（用于洞察时的"过往相关报道"上下文注入）
// 纯词面匹配：用全站高频实体字典（来自已抽取并存入 entities 字段的实体）去匹配
// 当前文章正文，命中后取共享实体的历史文章作为对比上下文。不引入 embedding，
// 不额外消耗模型调用。
// ─────────────────────────────────────────────────────────────────────────────

let entityDictionaryCache: string[] | null = null;
let entityDictionaryCachedAt = 0;
const ENTITY_DICTIONARY_TTL_MS = 60 * 60 * 1000;

/**
 * 返回近期文章中出现频次最高的实体（已小写化）。带模块级缓存，避免每条文章重复全表聚合。
 */
export async function getEntityDictionary(days = 30, max = 300): Promise<string[]> {
  const now = Date.now();
  if (entityDictionaryCache && now - entityDictionaryCachedAt < ENTITY_DICTIONARY_TTL_MS) {
    return entityDictionaryCache;
  }
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rs = await getDb().execute({
    sql: `SELECT lower(value) AS e
          FROM articles, json_each(entities)
          WHERE published_at >= ? AND json_valid(entities) AND value IS NOT NULL
          GROUP BY e
          ORDER BY COUNT(*) DESC
          LIMIT ?`,
    args: [since, max],
  });
  entityDictionaryCache = rs.rows.map((r) => String(r.e));
  entityDictionaryCachedAt = now;
  return entityDictionaryCache;
}

export interface RelatedArticle {
  id: string;
  title: string;
  titleZh: string | null;
  keyChange: string | null;
  publishedAt: string;
}

/**
 * 基于正文内容，找出共享实体的历史文章（排除自身），用于为洞察提供对比上下文。
 * 命中实体超过上限时仅取前若干个，避免上下文过长。
 */
export async function getRelatedByContent(
  content: string,
  excludeId: string,
  limit = 3,
): Promise<RelatedArticle[]> {
  const dict = await getEntityDictionary();
  if (dict.length === 0) return [];

  const lower = (content || "").toLowerCase();
  const matched: string[] = [];
  for (const e of dict) {
    if (e && lower.includes(e)) {
      matched.push(e);
      if (matched.length >= 8) break;
    }
  }
  if (matched.length === 0) return [];

  const placeholders = matched.map(() => "?").join(",");
  const rs = await getDb().execute({
    sql: `SELECT a.id AS id, a.title AS title, a.title_zh AS title_zh,
                 a.key_change AS key_change, a.published_at AS published_at
          FROM articles a
          WHERE a.id != ?
            AND json_valid(a.entities)
            AND EXISTS (
              SELECT 1 FROM json_each(a.entities) j
              WHERE lower(j.value) IN (${placeholders})
            )
          ORDER BY a.published_at DESC
          LIMIT ?`,
    args: [excludeId, ...matched, limit],
  });

  return rs.rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    titleZh: r.title_zh == null ? null : String(r.title_zh),
    keyChange: r.key_change == null ? null : String(r.key_change),
    publishedAt: String(r.published_at),
  }));
}

// ─── 源级熔断（circuit breaker）──────────────────────────────────────────────
// 背景：Google News / Substack / Reddit 等对 GitHub Actions 数据中心 IP 区别对待，
// 部分源持续失败（本地正常）。熔断避免死源每轮拖慢抓取，同时定期探测自动恢复。

export interface SourceHealth {
  failStreak: number;
  nextAttemptAt: string | null;
}

export async function getSourceHealth(): Promise<Map<string, SourceHealth>> {
  const map = new Map<string, SourceHealth>();
  const rs = await getDb().execute("SELECT id, fail_streak, next_attempt_at FROM sources");
  for (const row of rs.rows) {
    map.set(String(row.id), {
      failStreak: Number(row.fail_streak ?? 0),
      nextAttemptAt: row.next_attempt_at == null ? null : String(row.next_attempt_at),
    });
  }
  return map;
}

/** 冷却时长：从第 3 次连续失败起 2h 起，指数退避封顶 12h（3→2h, 4→4h, 5→8h, ≥6→12h） */
function cooldownHoursFor(failStreak: number): number {
  if (failStreak < 3) return 0;
  return Math.min(2 ** (failStreak - 2), 12);
}

export async function markSourceOutcomes(
  outcomes: { sourceId: string; ok: boolean }[],
): Promise<void> {
  if (outcomes.length === 0) return;
  const now = Date.now();
  const health = await getSourceHealth();
  const statements: InStatement[] = [];
  for (const { sourceId, ok } of outcomes) {
    const prev = health.get(sourceId);
    const streak = ok ? 0 : (prev?.failStreak ?? 0) + 1;
    const hours = cooldownHoursFor(streak);
    const next = ok || hours === 0 ? null : new Date(now + hours * 3_600_000).toISOString();
    statements.push({
      sql: `UPDATE sources SET fail_streak = ?, next_attempt_at = ? WHERE id = ?`,
      args: [streak, next, sourceId],
    });
  }
  await getDb().batch(statements, "write");
}
