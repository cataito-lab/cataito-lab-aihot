import "server-only";
import { getDb } from "./db";
import type { BriefMeta, CategoryCount, FeedArticle, FeedFilters, FeedPage } from "./types";

const PAGE_SIZE = 50;

export interface ArticleRow {
  id: unknown;
  source_id: unknown;
  source_name: unknown;
  category: unknown;
  lang: unknown;
  title: unknown;
  title_zh: unknown;
  summary: unknown;
  summary_en: unknown;
  summary_ja: unknown;
  summary_es: unknown;
  summary_fr: unknown;
  url: unknown;
  author: unknown;
  published_at: unknown;
  fetched_at: unknown;
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

export function toFeedArticle(row: ArticleRow): FeedArticle {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    sourceName: String(row.source_name),
    category: String(row.category),
    lang: String(row.lang),
    title: String(row.title),
    titleZh: str(row.title_zh),
    summary: str(row.summary),
    summaryEn: str(row.summary_en),
    summaryJa: str(row.summary_ja),
    summaryEs: str(row.summary_es),
    summaryFr: str(row.summary_fr),
    url: String(row.url),
    author: str(row.author),
    publishedAt: String(row.published_at),
    fetchedAt: row.fetched_at == null ? undefined : String(row.fetched_at),
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function encodeCursor(publishedAt: string, id: string): string {
  return toBase64Url(new TextEncoder().encode(`${publishedAt}|${id}`));
}

function decodeCursor(cursor: string | undefined): { at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const raw = new TextDecoder().decode(
      Uint8Array.from(bin, (c) => c.charCodeAt(0)),
    );
    const idx = raw.indexOf("|");
    if (idx <= 0 || idx === raw.length - 1) return null;
    return { at: raw.slice(0, idx), id: raw.slice(idx + 1) };
  } catch {
    return null;
  }
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listArticles(
  filters: FeedFilters,
  cursor?: string,
  limit: number = PAGE_SIZE,
): Promise<FeedPage> {
  const where: string[] = [];
  const args: (string | number)[] = [];
  let useFts = false;

  const cats = (filters.categories ?? []).filter(Boolean);
  if (cats.length > 0) {
    where.push(`s.category IN (${cats.map(() => "?").join(",")})`);
    args.push(...cats);
  } else if (filters.category && filters.category !== "all") {
    where.push("s.category = ?");
    args.push(filters.category);
  }
  if (filters.sourceId) {
    where.push("a.source_id = ?");
    args.push(filters.sourceId);
  }
  const q = filters.q?.trim();
  if (q) {
    if ([...q].length >= 3) {
      useFts = true;
      where.push("articles_fts MATCH ?");
      args.push(`"${q.replace(/"/g, '""')}"`);
    } else {
      const like = `%${escapeLike(q)}%`;
      where.push("(a.title LIKE ? ESCAPE '\\' OR a.title_zh LIKE ? ESCAPE '\\')");
      args.push(like, like);
    }
  }
  if (filters.hours && filters.hours > 0) {
    where.push("a.published_at >= ?");
    args.push(new Date(Date.now() - filters.hours * 3_600_000).toISOString());
  }

  const decoded = decodeCursor(cursor);
  if (decoded) {
    where.push("(a.published_at < ? OR (a.published_at = ? AND a.id < ?))");
    args.push(decoded.at, decoded.at, decoded.id);
  }

  const sql = `
    SELECT a.id, a.source_id, s.name AS source_name, s.category, s.lang,
           a.title, a.title_zh, a.summary, a.summary_en, a.summary_ja,
           a.summary_es, a.summary_fr, a.url, a.author,
           a.published_at, a.fetched_at
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    ${useFts ? "JOIN articles_fts ON articles_fts.article_id = a.id" : ""}
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY a.published_at DESC, a.id DESC
    LIMIT ?`;

  args.push(limit + 1);
  const rs = await (await getDb()).execute({ sql, args });
  const rows = rs.rows.map((row) => toFeedArticle(row as unknown as ArticleRow));
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor(last.publishedAt, last.id) : null;

  return { items, nextCursor };
}

export interface SourceInfo {
  id: string;
  name: string;
  category: string;
  lang: string;
  siteUrl: string;
  enabled: boolean;
  articleCount: number;
}

export async function listSources(): Promise<SourceInfo[]> {
  const db = await getDb();
  const rs = await db.execute(`
    SELECT s.id, s.name, s.category, s.lang, s.site_url, s.enabled,
           COUNT(a.id) AS article_count
    FROM sources s
    LEFT JOIN articles a ON a.source_id = s.id
    GROUP BY s.id
    ORDER BY s.category, s.name`);
  return rs.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    lang: String(row.lang),
    siteUrl: String(row.site_url),
    enabled: Number(row.enabled) === 1,
    articleCount: Number(row.article_count),
  }));
}

export interface DailyDateRow {
  date: string;
  count: number;
}

/** 最近 N 天有内容的日期及条数（存档索引用） */
export async function getDailyDates(limit = 30): Promise<DailyDateRow[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT substr(published_at, 1, 10) AS d, COUNT(*) AS n
          FROM articles GROUP BY d ORDER BY d DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((row) => ({
    date: String(row.d),
    count: Number(row.n),
  }));
}

/** 某个 UTC 日期（YYYY-MM-DD）的全部条目 */
export async function getDailyArticles(date: string): Promise<FeedArticle[]> {
  const db = await getDb();
  const start = `${date}T00:00:00.000Z`;
  const endDate = new Date(`${date}T00:00:00.000Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const rs = await db.execute({
    sql: `SELECT a.id, a.source_id, s.name AS source_name, s.category, s.lang,
                 a.title, a.title_zh, a.summary, a.summary_en, a.summary_ja,
                 a.summary_es, a.summary_fr, a.url, a.author,
                 a.published_at, a.fetched_at
          FROM articles a
          JOIN sources s ON s.id = a.source_id
          WHERE a.published_at >= ? AND a.published_at < ?
          ORDER BY a.published_at DESC
          LIMIT 400`,
    args: [start, endDate.toISOString()],
  });
  return rs.rows.map((row) => toFeedArticle(row as unknown as ArticleRow));
}

export async function getBriefMeta(): Promise<BriefMeta> {  const db = await getDb();

  const totalRs = await db.execute("SELECT COUNT(*) AS n FROM articles");
  const dayRs = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM articles WHERE published_at >= ?",
    args: [new Date(Date.now() - 24 * 3_600_000).toISOString()],
  });
  const catRs = await db.execute(`
    SELECT s.category AS cat, COUNT(a.id) AS n
    FROM sources s LEFT JOIN articles a ON a.source_id = s.id
    GROUP BY s.category`);
  const srcRs = await db.execute(
    "SELECT COUNT(*) AS n FROM sources WHERE enabled = 1",
  );
  const logRs = await db.execute(
    "SELECT finished_at FROM fetch_logs WHERE ok = 1 AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1",
  );

  const categoryCounts: CategoryCount[] = catRs.rows.map((row) => ({
    id: String(row.cat),
    count: Number(row.n),
  }));

  return {
    updatedAt: logRs.rows[0] ? String(logRs.rows[0].finished_at) : null,
    total: Number(totalRs.rows[0]?.n ?? 0),
    last24h: Number(dayRs.rows[0]?.n ?? 0),
    sourcesEnabled: Number(srcRs.rows[0]?.n ?? 0),
    categoryCounts,
  };
}
