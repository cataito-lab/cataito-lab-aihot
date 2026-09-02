import "server-only";
import { getDb } from "./db";
import { localizeAudience } from "./audiences";
import type {
  BriefMeta,
  CategoryCount,
  EventDetail,
  EventMember,
  FeedArticle,
  FeedFilters,
  FeedPage,
} from "./types";

const PAGE_SIZE = 50;

/** AIHOT 评分准入线：低于此分不进 Feed；未评分（NULL）保底展示。可用环境变量调整。 */
const SCORE_THRESHOLD = Number(process.env.SCORE_THRESHOLD ?? 60);

export interface ArticleRow {
  id: unknown;
  source_id: unknown;
  source_name: unknown;
  category: unknown;
  lang: unknown;
  title: unknown;
  title_zh: unknown;
  title_ja: unknown;
  title_es: unknown;
  title_fr: unknown;
  summary: unknown;
  summary_en: unknown;
  summary_ja: unknown;
  summary_es: unknown;
  summary_fr: unknown;
  key_points: unknown;
  industry_impact: unknown;
  score_final: unknown;
  event_id: unknown;
  event_summary: unknown;
  event_key: unknown;
  key_change: unknown;
  key_change_en: unknown;
  key_change_ja: unknown;
  key_change_es: unknown;
  key_change_fr: unknown;
  why_it_matters: unknown;
  why_it_matters_en: unknown;
  why_ja: unknown;
  why_es: unknown;
  why_fr: unknown;
  forward_signal: unknown;
  forward_signal_en: unknown;
  forward_signal_ja: unknown;
  forward_signal_es: unknown;
  forward_signal_fr: unknown;
  impact: unknown;
  impact_en: unknown;
  impact_ja: unknown;
  impact_es: unknown;
  impact_fr: unknown;
  ai_category: unknown;
  ai_category_en: unknown;
  importance_score: unknown;
  entities: unknown;
  url: unknown;
  author: unknown;
  published_at: unknown;
  fetched_at: unknown;
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

/** JSON 数组文本 → string[] | null（供 entities 字段使用） */
function parseJsonArray(v: unknown): string[] | null {
  if (v == null) return null;
  try {
    const arr = JSON.parse(String(v));
    if (!Array.isArray(arr)) return null;
    const out = arr.filter((x): x is string => typeof x === "string");
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** 句末标点规范化（跨语言安全）：按目标语言强制末尾为正确标点。
 *  - 目标标点已存在 → 保留
 *  - 结尾是其它标点（中英文句号/逗号/顿号/冒号/分号）→ 替换为目标标点
 *    （解决英文 *En 字段误用中文句号「。」的问题）
 *  - 结尾是 ！!？?… → 保留（有意义的叹/问/省略，不强行改句号）
 *  - 其它（无标点/普通字符）→ 补目标标点
 *  用于统一 AI 洞察各字段的句号，消除"有的有句号、有的没有 / 中英文句号混用"。 */
function ensureEndPunct(s: string | null, punct: string): string | null {
  if (s == null) return null;
  const t = s.trim();
  if (!t) return s;
  const last = t.slice(-1);
  if (last === punct) return t;
  if (/[！!？?…]/.test(last)) return t;
  if (/[。.，,、；;：:]/.test(last)) return t.slice(0, -1) + punct;
  return t + punct;
}

/** impact 为 JSON 数组（[{audience,description}]），逐条规范化受众大小写与 description 末尾标点；
 * zh 列的 audience 走 localizeAudience（词表兜底），其它列（ja/es/fr）已是翻译后文本，只补标点。 */
function normalizeImpact(json: string | null, punct: string, locale: "zh" | "en" | "ja" | "es" | "fr" = "zh"): string | null {
  if (!json) return json;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return json;
    const out = arr.map((x) => {
      if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        const next: Record<string, unknown> = { ...x };
        const audience = typeof o.audience === "string" ? cleanInsightText(o.audience) ?? "" : "";
        if (locale === "zh") {
          // zh 列走词表映射（词表外兜底为 titleCase），避免中文 locale 下残留英文品牌/组织名
          const mapped = localizeAudience(audience, "zh") || normalizeCategoryToken(audience);
          next.audience = mapped || "";
        } else if (locale === "en") {
          next.audience = normalizeCategoryToken(audience);
        } else {
          next.audience = audience;
        }
        const desc = cleanInsightText(o.description);
        if (typeof o.description === "string") {
          next.description = ensureEndPunct(zhQuoteNormalize(desc, locale), punct) ?? "";
        }
        return next;
      }
      return x;
    });
    return JSON.stringify(out);
  } catch {
    return json;
  }
}

/** 中文文本内的引号规范化：把 ASCII 双/单引号替换为全角「」/『』，
 * 避免中文摘要/影响字段出现 "主动式AI"、'foo' 这种半角引号。 */
function zhQuoteNormalize(s: string | null, locale: "zh" | "en" | "ja" | "es" | "fr"): string | null {
  if (!s || locale !== "zh") return s;
  let out = "";
  let openDq = false, openSq = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      out += openDq ? "」" : "「";
      openDq = !openDq;
    } else if (c === "'") {
      out += openSq ? "』" : "『";
      openSq = !openSq;
    } else {
      out += c;
    }
  }
  return out;
}

/** 剥离洞察文本开头的语言/字段标签前缀（模型常在字段值前加「中文：」「English：」「描述：」等），
 *  避免在各语言界面下出现冗余标签或多语言混杂。仅去开头前缀，不改动正文其余内容。 */
function cleanInsightText(s: string | null): string | null {
  if (s == null) return null;
  let t = s.trim();
  // 去掉开头语言/字段标签前缀：中文/英文/英语/English/EN/En/描述/Description/Desc + 可选空格 + 中英文冒号（大小写不敏感）
  t = t.replace(/^(中文|英文|英语|English|EN|En|描述|Description|Desc)\s*[:：]\s*/i, "");
  return t;
}

/** 分类/受众等短标签的大小写规范化：首字母大写（保留空格与连字符），并保护已知缩写与品牌名。 */
const CASING_ACRONYMS = new Set([
  "AI", "API", "LLM", "GUI", "PC", "ML", "NLP", "GPU", "TPU", "CPU", "AGI", "ASI",
  "AR", "VR", "MR", "XR", "UI", "UX", "JSON", "XML", "SQL", "CLI", "SDK", "IoT",
  "QA", "DB", "MoE", "RL", "CV", "TS", "HUD", "3D", "2D",
]);
const CASING_BRANDS: Record<string, string> = {
  openai: "OpenAI", github: "GitHub", copilot: "Copilot", chatgpt: "ChatGPT",
  deepmind: "DeepMind", meta: "Meta", google: "Google", microsoft: "Microsoft",
  nvidia: "Nvidia", "hugging face": "Hugging Face", anthropic: "Anthropic",
  mistral: "Mistral", xai: "xAI", perplexity: "Perplexity", claude: "Claude",
  gemini: "Gemini", llama: "Llama", gpt: "GPT", cursor: "Cursor", gradio: "Gradio",
  langchain: "LangChain", pytorch: "PyTorch", tensorflow: "TensorFlow",
  midjourney: "Midjourney", runway: "Runway", cohere: "Cohere", "stability ai": "Stability AI",
};

function titleCaseWord(w: string): string {
  if (!w) return w;
  const low = w.toLowerCase();
  if (CASING_ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
  if (CASING_BRANDS[low]) return CASING_BRANDS[low];
  // 保护位于词首的缩写（无分隔符紧贴时），如「AI研究」=>「AI研究」而非「Ai研究」；
  // 仅当缩写后紧跟非拉丁字母（中文等）才视为前缀，避免把 Artificial/Art 误判为 AR/AI 前缀
  for (const a of CASING_ACRONYMS) {
    if (w.length > a.length && w.toLowerCase().startsWith(a.toLowerCase())) {
      const rest = w.slice(a.length);
      const c = rest.charAt(0);
      if (c && !/[a-zA-Z]/.test(c)) return a + titleCaseWord(rest);
    }
  }
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function normalizeCategoryToken(s: string): string {
  return s
    .split(/(\s+|-)/)
    .map((part) => /^[\s-]*$/.test(part) || part === "" ? part : titleCaseWord(part))
    .join("");
}

/** 分类字段为 JSON 字符串数组，逐条规范大小写（读取层统一，覆盖新旧数据）。 */
function normalizeCategories(json: string | null): string | null {
  if (!json) return json;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return json;
    const out = arr
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => normalizeCategoryToken(x.trim()));
    return out.length ? JSON.stringify(out) : null;
  } catch {
    return json;
  }
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
    titleJa: str(row.title_ja),
    titleEs: str(row.title_es),
    titleFr: str(row.title_fr),
    summary: ensureEndPunct(cleanInsightText(str(row.summary)), "。"),
    summaryEn: ensureEndPunct(cleanInsightText(str(row.summary_en)), "."),
    summaryJa: ensureEndPunct(cleanInsightText(str(row.summary_ja)), "。"),
    summaryEs: ensureEndPunct(cleanInsightText(str(row.summary_es)), "."),
    summaryFr: ensureEndPunct(cleanInsightText(str(row.summary_fr)), "."),
    keyPoints: str(row.key_points),
    industryImpact: str(row.industry_impact),
    scoreFinal: row.score_final == null ? null : Number(row.score_final),
    eventId: row.event_id == null ? null : String(row.event_id),
    eventSummary: ensureEndPunct(cleanInsightText(str(row.event_summary)), "。"),
    eventKey: row.event_key == null ? null : String(row.event_key),
    keyChange: ensureEndPunct(cleanInsightText(str(row.key_change)), "。"),
    keyChangeEn: ensureEndPunct(cleanInsightText(str(row.key_change_en)), "."),
    keyChangeJa: ensureEndPunct(cleanInsightText(str(row.key_change_ja)), "。"),
    keyChangeEs: ensureEndPunct(cleanInsightText(str(row.key_change_es)), "。"),
    keyChangeFr: ensureEndPunct(cleanInsightText(str(row.key_change_fr)), "."),
    whyItMatters: ensureEndPunct(cleanInsightText(str(row.why_it_matters)), "。"),
    whyItMattersEn: ensureEndPunct(cleanInsightText(str(row.why_it_matters_en)), "."),
    whyItMattersJa: ensureEndPunct(cleanInsightText(str(row.why_ja)), "。"),
    whyItMattersEs: ensureEndPunct(cleanInsightText(str(row.why_es)), "。"),
    whyItMattersFr: ensureEndPunct(cleanInsightText(str(row.why_fr)), "."),
    forwardSignal: ensureEndPunct(cleanInsightText(str(row.forward_signal)), "。"),
    forwardSignalEn: ensureEndPunct(cleanInsightText(str(row.forward_signal_en)), "."),
    forwardSignalJa: ensureEndPunct(cleanInsightText(str(row.forward_signal_ja)), "。"),
    forwardSignalEs: ensureEndPunct(cleanInsightText(str(row.forward_signal_es)), "。"),
    forwardSignalFr: ensureEndPunct(cleanInsightText(str(row.forward_signal_fr)), "."),
    impact: normalizeImpact(str(row.impact), "。", "zh"),
    impactEn: normalizeImpact(str(row.impact_en), ".", "en"),
    impactJa: normalizeImpact(str(row.impact_ja), "。", "ja"),
    impactEs: normalizeImpact(str(row.impact_es), ".", "es"),
    impactFr: normalizeImpact(str(row.impact_fr), ".", "fr"),
    aiCategory: normalizeCategories(str(row.ai_category)),
    aiCategoryEn: normalizeCategories(str(row.ai_category_en)),
    importanceScore: row.importance_score == null ? null : Number(row.importance_score),
    entities: parseJsonArray(row.entities),
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

export function encodeCursor(sort: string, vals: Array<string | number>): string {
  return toBase64Url(new TextEncoder().encode(vals.join("|")));
}

function decodeCursor(cursor: string | undefined, sort: string): Array<string | number> | null {
  if (!cursor) return null;
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const raw = new TextDecoder().decode(
      Uint8Array.from(bin, (c) => c.charCodeAt(0)),
    );
    const parts = raw.split("|");
    if (sort === "importance") {
      if (parts.length !== 3) return null;
      const score = Number(parts[0]);
      if (!Number.isFinite(score)) return null;
      return [score, parts[1], parts[2]];
    }
    if (parts.length !== 2) return null;
    return [parts[0], parts[1]];
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
  const sort = filters.sort === "importance" ? "importance" : "time";
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
  where.push(`(a.score_final IS NULL OR a.score_final >= ?)`);
  args.push(SCORE_THRESHOLD);

  const decoded = decodeCursor(cursor, sort);
  if (decoded) {
    if (sort === "importance") {
      const c = decoded[0] as number;
      const at = decoded[1] as string;
      const id = decoded[2] as string;
      where.push(
        "(COALESCE(a.importance_score, a.score_final) < ? OR (COALESCE(a.importance_score, a.score_final) = ? AND a.published_at < ?) OR (COALESCE(a.importance_score, a.score_final) = ? AND a.published_at = ? AND a.id < ?))",
      );
      args.push(c, c, at, c, at, id);
    } else {
      const at = decoded[0] as string;
      const id = decoded[1] as string;
      where.push("(a.published_at < ? OR (a.published_at = ? AND a.id < ?))");
      args.push(at, at, id);
    }
  }

  const sql = `
    SELECT a.id, a.source_id, s.name AS source_name, s.category, s.lang,
           a.title, a.title_zh, a.title_ja, a.title_es, a.title_fr, a.summary, a.summary_en, a.summary_ja,
           a.summary_es, a.summary_fr, a.url, a.author,
           a.published_at, a.fetched_at,
             a.key_points, a.industry_impact, a.score_final,
              a.key_change, a.key_change_en, a.key_change_ja, a.key_change_es, a.key_change_fr,
              a.why_it_matters, a.why_it_matters_en, a.why_ja, a.why_es, a.why_fr,
              a.forward_signal, a.forward_signal_en, a.forward_signal_ja, a.forward_signal_es, a.forward_signal_fr,
               a.impact, a.impact_en, a.impact_ja, a.impact_es, a.impact_fr, a.category AS ai_category, a.category_en AS ai_category_en, a.importance_score,
              a.entities,
              a.event_id, e.summary AS event_summary, e.event_key AS event_key
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      LEFT JOIN events e ON e.id = a.event_id
      ${useFts ? "JOIN articles_fts ON articles_fts.article_id = a.id" : ""}
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${sort === "importance" ? "COALESCE(a.importance_score, a.score_final) DESC, a.published_at DESC, a.id DESC" : "a.published_at DESC, a.id DESC"}
    LIMIT ?`;

  args.push(limit + 1);
  const rs = await (await getDb()).execute({ sql, args });
  const rows = rs.rows.map((row) => toFeedArticle(row as unknown as ArticleRow));
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          sort,
          sort === "importance"
            ? [(last.importanceScore ?? last.scoreFinal ?? -1), last.publishedAt, last.id]
            : [last.publishedAt, last.id],
        )
      : null;

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
                 a.title, a.title_zh, a.title_ja, a.title_es, a.title_fr, a.summary, a.summary_en, a.summary_ja,
                 a.summary_es, a.summary_fr, a.url, a.author,
                 a.published_at, a.fetched_at,
                  a.key_points, a.industry_impact, a.score_final,
                  a.event_id, e.summary AS event_summary, e.event_key AS event_key
           FROM articles a
           JOIN sources s ON s.id = a.source_id
           LEFT JOIN events e ON e.id = a.event_id
           WHERE a.published_at >= ? AND a.published_at < ?
            AND (a.score_final IS NULL OR a.score_final >= ?)
          ORDER BY a.published_at DESC
          LIMIT 400`,
    args: [start, endDate.toISOString(), SCORE_THRESHOLD],
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

/** 取事件（按 event_key），含其全部成员报道；不存在返回 null */
export async function getEvent(key: string): Promise<EventDetail | null> {
  const db = await getDb();
  const ev = await db.execute({
    sql: `SELECT e.id, e.event_key, e.title, e.title_zh, e.summary, e.summary_en,
                 e.source_count, e.first_seen, e.last_seen, e.peak_score
          FROM events e WHERE e.event_key = ?`,
    args: [key],
  });
  const row = ev.rows[0];
  if (!row) return null;
  const members = await getEventMembers(String(row.id));
  return {
    id: String(row.id),
    eventKey: String(row.event_key),
    title: str(row.title),
    titleZh: str(row.title_zh),
    titleJa: str(row.title_ja),
    titleEs: str(row.title_es),
    titleFr: str(row.title_fr),
    summary: ensureEndPunct(cleanInsightText(str(row.summary)), "。"),
    summaryEn: ensureEndPunct(cleanInsightText(str(row.summary_en)), "."),
    sourceCount: Number(row.source_count ?? 0),
    firstSeen: String(row.first_seen),
    lastSeen: String(row.last_seen),
    peakScore: row.peak_score == null ? null : Number(row.peak_score),
    members,
  };
}

/** 事件的全部成员报道（按发布时间倒序） */
export async function getEventMembers(eventId: string): Promise<EventMember[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT a.id, a.source_id, s.name AS source_name, s.category, s.lang,
                  a.title, a.title_zh, a.title_ja, a.title_es, a.title_fr, a.summary, a.summary_en, a.summary_ja,
                  a.summary_es, a.summary_fr, a.url, a.author, a.published_at, a.score_final,
                  a.key_change, a.key_change_en, a.key_change_ja, a.key_change_es, a.key_change_fr,
                  a.why_it_matters, a.why_it_matters_en, a.why_ja, a.why_es, a.why_fr,
                  a.forward_signal, a.forward_signal_en, a.forward_signal_ja, a.forward_signal_es, a.forward_signal_fr,
                 a.impact, a.impact_en, a.impact_ja, a.impact_es, a.impact_fr, a.category AS ai_category, a.category_en AS ai_category_en, a.importance_score,
                 a.entities
          FROM articles a JOIN sources s ON s.id = a.source_id
          WHERE a.event_id = ?
          ORDER BY a.published_at DESC`,
    args: [eventId],
  });
  return rs.rows.map((r) => ({
    id: String(r.id),
    sourceId: String(r.source_id),
    sourceName: String(r.source_name),
    category: String(r.category),
    lang: String(r.lang),
    title: String(r.title),
    titleZh: str(r.title_zh),
    titleJa: str(r.title_ja),
    titleEs: str(r.title_es),
    titleFr: str(r.title_fr),
    summary: ensureEndPunct(cleanInsightText(str(r.summary)), "。"),
    summaryEn: ensureEndPunct(cleanInsightText(str(r.summary_en)), "."),
    summaryJa: ensureEndPunct(cleanInsightText(str(r.summary_ja)), "。"),
    summaryEs: ensureEndPunct(cleanInsightText(str(r.summary_es)), "."),
    summaryFr: ensureEndPunct(cleanInsightText(str(r.summary_fr)), "."),
    scoreFinal: r.score_final == null ? null : Number(r.score_final),
    keyChange: ensureEndPunct(cleanInsightText(str(r.key_change)), "。"),
    keyChangeEn: ensureEndPunct(cleanInsightText(str(r.key_change_en)), "."),
    keyChangeJa: ensureEndPunct(cleanInsightText(str(r.key_change_ja)), "。"),
    keyChangeEs: ensureEndPunct(cleanInsightText(str(r.key_change_es)), "。"),
    keyChangeFr: ensureEndPunct(cleanInsightText(str(r.key_change_fr)), "."),
    whyItMatters: ensureEndPunct(cleanInsightText(str(r.why_it_matters)), "。"),
    whyItMattersEn: ensureEndPunct(cleanInsightText(str(r.why_it_matters_en)), "."),
    whyItMattersJa: ensureEndPunct(cleanInsightText(str(r.why_ja)), "。"),
    whyItMattersEs: ensureEndPunct(cleanInsightText(str(r.why_es)), "。"),
    whyItMattersFr: ensureEndPunct(cleanInsightText(str(r.why_fr)), "."),
    forwardSignal: ensureEndPunct(cleanInsightText(str(r.forward_signal)), "。"),
    forwardSignalEn: ensureEndPunct(cleanInsightText(str(r.forward_signal_en)), "."),
    forwardSignalJa: ensureEndPunct(cleanInsightText(str(r.forward_signal_ja)), "。"),
    forwardSignalEs: ensureEndPunct(cleanInsightText(str(r.forward_signal_es)), "。"),
    forwardSignalFr: ensureEndPunct(cleanInsightText(str(r.forward_signal_fr)), "."),
    impact: normalizeImpact(str(r.impact), "。", "zh"),
    impactEn: normalizeImpact(str(r.impact_en), ".", "en"),
    impactJa: normalizeImpact(str(r.impact_ja), "。", "ja"),
    impactEs: normalizeImpact(str(r.impact_es), ".", "es"),
    impactFr: normalizeImpact(str(r.impact_fr), ".", "fr"),
    aiCategory: normalizeCategories(str(r.ai_category)),
    aiCategoryEn: normalizeCategories(str(r.ai_category_en)),
    importanceScore: r.importance_score == null ? null : Number(r.importance_score),
    entities: parseJsonArray(r.entities),
    url: String(r.url),
    author: str(r.author),
    publishedAt: String(r.published_at),
  }));
}

/** 实体页：列出提到某实体的全部文章（按发布时间倒序），用于知识图谱跳转 */
export async function getEntityArticles(name: string, limit = 200): Promise<FeedArticle[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT a.id, a.source_id, s.name AS source_name, s.category, s.lang,
                 a.title, a.title_zh, a.title_ja, a.title_es, a.title_fr, a.summary, a.summary_en, a.summary_ja,
                 a.summary_es, a.summary_fr, a.url, a.author,
                 a.published_at, a.fetched_at,
                 a.key_points, a.industry_impact, a.score_final,
                 a.key_change, a.key_change_en, a.why_it_matters, a.why_it_matters_en,
                 a.forward_signal, a.forward_signal_en,
                 a.impact, a.impact_en, a.category AS ai_category, a.category_en AS ai_category_en, a.importance_score,
                 a.entities,
                 a.event_id, e.summary AS event_summary, e.event_key AS event_key
          FROM articles a
          JOIN sources s ON s.id = a.source_id
          LEFT JOIN events e ON e.id = a.event_id
          WHERE json_valid(a.entities)
            AND EXISTS (SELECT 1 FROM json_each(a.entities) j WHERE lower(j.value) = lower(?))
          ORDER BY a.published_at DESC
          LIMIT ?`,
    args: [name, limit],
  });
  return rs.rows.map((r) => toFeedArticle(r as unknown as ArticleRow));
}

/** 用于 sitemap：近期多源事件的 event_key 列表 */
export async function listEventKeys(limit = 200): Promise<string[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT event_key FROM events WHERE source_count >= 2 ORDER BY last_seen DESC LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => String(r.event_key)).filter((k) => k.length > 0);
}

/** 用于 sitemap：近 30 天出现 ≥2 次的高频实体（保持原始大小写形式） */
export async function listEntityNames(limit = 100): Promise<string[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT j.value AS name, COUNT(*) AS n
          FROM articles a,
               json_each(CASE WHEN json_valid(a.entities) THEN a.entities ELSE '[]' END) j
          WHERE a.published_at >= datetime('now', '-30 days')
          GROUP BY j.value
          HAVING COUNT(*) >= 2
          ORDER BY n DESC, name ASC
          LIMIT ?`,
    args: [limit],
  });
  return rs.rows.map((r) => String(r.name)).filter((n) => n.length > 0 && n.length <= 60);
}
