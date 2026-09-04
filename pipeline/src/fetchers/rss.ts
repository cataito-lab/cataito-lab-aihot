import Parser from "rss-parser";
import { httpFetch } from "../net";
import type { RawItem, SourceDef } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ai-news-pipeline/0.1";

const parser = new Parser({
  headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
});

const MAX_PER_SOURCE = 50;
const TIMEOUT_MS = 45000;

function cleanXml(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

async function fetchFeedText(feedUrl: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await httpFetch(feedUrl, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return cleanXml(await res.text());
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// 剥掉标题开头的栏目标签，如 Latent Space 下发的 "[AINews] "、"[Machine Learning] "。
// 只去最前面的 [..] 前缀，标题其它位置的括号保持不变。
const LEADING_TAG_RE = /^\[[^\]\n]{1,30}\]\s*/;

function cleanTitle(raw: string): string {
  return raw.replace(LEADING_TAG_RE, "").replace(/\s+/g, " ").trim();
}

/** 提取正文文本：去 HTML 标签、压缩空白、截断到 maxChars */
function extractText(raw: unknown, maxChars: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

/** RSS 的 creator 可能是字符串/对象{name}/数组（不同源结构不一），统一归一化为 string | undefined */
function asText(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return asText(v[0]);
  if (v && typeof v === "object") {
    const n = (v as { name?: unknown }).name;
    if (typeof n === "string") return n;
  }
  return undefined;
}

export async function fetchRss(source: SourceDef, windowHours: number): Promise<RawItem[]> {
  if (!source.feedUrl) return [];
  const xml = await fetchFeedText(source.feedUrl);
  const feed = await parser.parseString(xml);
  const cutoffMs = Date.now() - windowHours * 3_600_000;
  const items: RawItem[] = [];
  for (const entry of feed.items) {
    if (!entry.title || !entry.link) continue;
    const published = entry.isoDate ? new Date(entry.isoDate) : null;
    if (published && Number.isNaN(published.getTime())) continue;
    // 将 publishedAt 换算为真正的 UTC：部分源把源站本地时间错标成 GMT，
    // 通过 publishedAtTz 声明实际时区，这里重贴时区偏移后转 UTC。
    const publishedAt = normalizePublishedAt(entry.isoDate ?? "", source.publishedAtTz, published);
    if (published && published.getTime() < cutoffMs) continue;
    items.push({
      sourceId: source.id,
      title: cleanTitle(entry.title),
      url: entry.link,
      publishedAt,
      sourceTimezone: source.publishedAtTz ?? "UTC",
      author: asText(entry.creator),
      articleContent:
        extractText((entry as Record<string, unknown>).content, 800) ||
        extractText(entry.description, 800) ||
        undefined,
    });
    if (items.length >= (source.maxPerSource ?? MAX_PER_SOURCE)) break;
  }
  return items;
}

/** 计算 IANA 时区相对 UTC 的偏移秒数。用年中 UTC 时刻，取该时区下对应的 local 分量，
 *  反算出 true UTC 与 local UTC 的差，即为时区偏移。 */
function tzOffsetSeconds(tz: string, refYear = 2026): number {
  const utcMs = Date.UTC(refYear, 6, 1, 12, 0, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const localMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((localMs - utcMs) / 1000);
}

/** 把源站时间按声明时区换算成真正的 UTC ISO 字符串。
 * 例：pubDate="Sun, 23 Aug 2026 14:09:00 GMT"（实为北京时间）+ publishedAtTz="Asia/Shanghai"
 *     → 视 14:09 为 CST(+8) → 真正 UTC 是 06:09 → 返回 "2026-08-23T06:09:00.000Z"
 * 前端 toLocaleString('Asia/Shanghai') 换算 +8 → 14:09 ✓ */
function normalizePublishedAt(
  rawIso: string,
  tz?: string,
  parsedDate?: Date | null,
): string {
  if (!tz || !rawIso || !parsedDate) return (parsedDate ?? new Date()).toISOString();
  // JS 把 "14:09:00 GMT" 解析成 14:09 UTC。我们要把它当作"来源时区 t 的 14:09"，
  // 算出真正的 UTC：trueUTC = parsedUTC - tzOffset(t)。
  const offsetSec = tzOffsetSeconds(tz, parsedDate.getUTCFullYear());
  const trueUtcMs = parsedDate.getTime() - offsetSec * 1000;
  return new Date(trueUtcMs).toISOString();
}
