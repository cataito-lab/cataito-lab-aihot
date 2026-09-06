import "server-only";
import { getDb } from "./db";
import { encodeCursor, toFeedArticle, type ArticleRow } from "./news";
import type { FeedArticle } from "./types";

/** 与 Feed 一致的评分准入线（未评分 NULL 保底展示） */
const SCORE_THRESHOLD = Number(process.env.SCORE_THRESHOLD ?? 60);

/**
 * V2 原型站数据层（分层展示）：
 *  - getDailyTop：近 N 小时「有完整洞察」的高分文章 → 今日精选（每事件只取最高分一条）
 *  - getStreamLite：轻量标题流（不拉 25 个洞察列）→ 实时动态
 * 复用 news.ts 的 toFeedArticle / encodeCursor，缺失翻译仍由 localize.pick* 严格隔离处理。
 */

/** 轻量动态条目：只有标题级字段，翻页/懒加载用 */
export interface StreamEntry {
  id: string;
  sourceId: string;
  sourceName: string;
  category: string;
  lang: string;
  title: string;
  titleZh: string | null;
  titleJa: string | null;
  titleEs: string | null;
  titleFr: string | null;
  url: string;
  publishedAt: string;
  eventId: string | null;
  eventKey: string | null;
  scoreFinal: number | null;
  importanceScore: number | null;
}

export interface StreamPage {
  items: StreamEntry[];
  nextCursor: string | null;
}

const STREAM_SELECT = `
  SELECT a.id, a.source_id, s.name AS source_name, s.category, s.lang,
         a.title, a.title_zh, a.title_ja, a.title_es, a.title_fr,
         a.url, a.published_at, a.score_final, a.importance_score,
         a.event_id, e.event_key AS event_key
  FROM articles a
  JOIN sources s ON s.id = a.source_id
  LEFT JOIN events e ON e.id = a.event_id`;

function toStreamEntry(row: Record<string, unknown>): StreamEntry {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    sourceName: String(row.source_name),
    category: String(row.category),
    lang: String(row.lang),
    title: String(row.title),
    titleZh: row.title_zh == null ? null : String(row.title_zh),
    titleJa: row.title_ja == null ? null : String(row.title_ja),
    titleEs: row.title_es == null ? null : String(row.title_es),
    titleFr: row.title_fr == null ? null : String(row.title_fr),
    url: String(row.url),
    publishedAt: String(row.published_at),
    eventId: row.event_id == null ? null : String(row.event_id),
    eventKey: row.event_key == null ? null : String(row.event_key),
    scoreFinal: row.score_final == null ? null : Number(row.score_final),
    importanceScore: row.importance_score == null ? null : Number(row.importance_score),
  };
}

/**
 * 今日精选：时间窗内 importance_score 达标且有完整洞察（key_change 非空）的文章，
 * 按重要度排序；同一事件（event_id 相同）只保留最高分一条，并统计该事件的信源数。
 */
export async function getDailyTop(options?: {
  hours?: number;
  limit?: number;
  minImportance?: number;
}): Promise<{ items: FeedArticle[]; eventSourceCounts: Map<string, number> }> {
  const { hours = 48, limit = 16, minImportance = 55 } = options ?? {};
  const db = await getDb();
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();

  // 每事件可能有多条成员报道，多取 2 倍候选再去重截断；
  // 列集与 news.ts listArticles 对齐，保证 toFeedArticle 可直接复用
  const rs = await db.execute({
    sql: `SELECT a.id, a.source_id, s.name AS source_name, s.category, s.lang,
                 a.title, a.title_zh, a.title_ja, a.title_es, a.title_fr,
                 a.summary, a.summary_en, a.summary_ja, a.summary_es, a.summary_fr,
                 a.url, a.author, a.published_at, a.fetched_at,
                 a.key_points, a.industry_impact, a.score_final,
                 a.key_change, a.key_change_en, a.key_change_ja, a.key_change_es, a.key_change_fr,
                 a.why_it_matters, a.why_it_matters_en, a.why_ja, a.why_es, a.why_fr,
                 a.forward_signal, a.forward_signal_en, a.forward_signal_ja, a.forward_signal_es, a.forward_signal_fr,
                 a.impact, a.impact_en, a.impact_ja, a.impact_es, a.impact_fr,
                 a.category AS ai_category, a.category_en AS ai_category_en, a.importance_score,
                 a.entities, a.event_id,
                 e.summary AS event_summary, e.event_key AS event_key
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN events e ON e.id = a.event_id
    WHERE a.published_at >= ?
      AND a.importance_score IS NOT NULL
      AND a.importance_score >= ?
      AND a.key_change IS NOT NULL
    ORDER BY a.importance_score DESC, a.published_at DESC, a.id DESC
    LIMIT ?`,
    args: [cutoff, minImportance, limit * 3],
  });

  const eventSourceCounts = new Map<string, number>();
  const seenEvents = new Set<string>();
  const items: FeedArticle[] = [];
  for (const raw of rs.rows) {
    const row = raw as unknown as ArticleRow;
    const eventId = row.event_id == null ? null : String(row.event_id);
    if (eventId) {
      eventSourceCounts.set(eventId, (eventSourceCounts.get(eventId) ?? 0) + 1);
      if (seenEvents.has(eventId)) continue;
      seenEvents.add(eventId);
    }
    items.push(toFeedArticle(row));
    if (items.length >= limit) break;
  }
  return { items, eventSourceCounts };
}

/** 时间序 keyset 游标解码（与 encodeCursor("time", [publishedAt, id]) 配对） */
function decodeTimeCursor(
  cursor: string | undefined,
): [string, string] | null {
  if (!cursor) return null;
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const raw = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    const parts = raw.split("|");
    if (parts.length !== 2) return null;
    return [parts[0], parts[1]];
  } catch {
    return null;
  }
}

/** 实时动态：轻量 SELECT + 时间序 keyset 分页；纯标题展示，不拉洞察列 */
export async function getStreamLite(
  cursor?: string,
  limit = 40,
  hours = 168,
): Promise<StreamPage> {
  const db = await getDb();
  const where: string[] = ["(a.score_final IS NULL OR a.score_final >= ?)"];
  const args: (string | number)[] = [SCORE_THRESHOLD];
  if (hours > 0) {
    where.push("a.published_at >= ?");
    args.push(new Date(Date.now() - hours * 3_600_000).toISOString());
  }
  const decoded = decodeTimeCursor(cursor);
  if (decoded) {
    where.push("(a.published_at < ? OR (a.published_at = ? AND a.id < ?))");
    args.push(decoded[0], decoded[0], decoded[1]);
  }

  const rs = await db.execute({
    sql: `${STREAM_SELECT}
      WHERE ${where.join(" AND ")}
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT ?`,
    args: [...args, limit + 1],
  });

  const entries = rs.rows.map((row) => toStreamEntry(row as Record<string, unknown>));
  const hasMore = entries.length > limit;
  const items = hasMore ? entries.slice(0, limit) : entries;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor("time", [last.publishedAt, last.id]) : null;
  return { items, nextCursor };
}
