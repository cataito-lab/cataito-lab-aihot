/**
 * C8 enrich：对 title-only 源（HN / Reddit / Twitter / Google News 等）的条目，
 * 抓取源文 URL 提取正文文本，回填到 RawItem.articleContent。
 *
 * 前置过滤（不抓取这些）：
 *   - 已有正文（例如 RSS 源）
 *   - HN 评论页（news.ycombinator.com/item?id= 无独立正文）
 *   - Twitter/X 帖子（反爬 + 需 token）
 *   - Reddit 原生帖（r/.../comments/ 无独立正文，且反爬）
 *   - 已知只承载元数据的短 URL
 *
 * 只真正有独立正文的源（The Register / TechCrunch / Ars / Wired 等）才抓。
 */
import pLimit from "p-limit";
import { httpFetch } from "./net";
import type { RawItem } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ai-news-pipeline/0.1";

/** 明确跳过正文抓取的 URL 模式 */
function shouldSkipUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes("news.ycombinator.com/item?id=")) return true;
  if (lower.startsWith("https://twitter.com/")) return true;
  if (lower.startsWith("https://x.com/")) return true;
  return lower.indexOf("reddit.com/r/") >= 0 && lower.includes("/comments/");
}
const MAX_BODY_CHARS = 1200;
const FETCH_TIMEOUT_MS = 12000;

function stripHtml(s: string): string {
  return s
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 尝试从 HTML 里挑主要文本段落，去广告/导航/页脚。
 * 启发式：找 <article> → <main> → <body> 中最长的连续 <p> 集合。
 */
function pickMainText(html: string): string {
  // 1. 优先 <article> / <main>
  const container = html
    .match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ??
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[2] ??
    html;
  // 2. 抓所有 <p> 内容
  const paras = container.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  const texts = paras.map((p) => stripHtml(p)).filter((t) => t.length > 40);
  // 3. 拼接前若干个段落，直到超上限
  let out = "";
  for (const t of texts) {
    const add = t + " ";
    if (out.length + add.length > MAX_BODY_CHARS) break;
    out += add;
  }
  // 4. 如果没有 <p>，退化为整段正文文本
  if (out.length < 200) {
    out = stripHtml(container).slice(0, MAX_BODY_CHARS);
  }
  return out.slice(0, MAX_BODY_CHARS).trim();
}

async function fetchBody(url: string): Promise<string | null> {
  try {
    const res = await httpFetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const html = (await res.text()) as string;
    if (!html || html.length < 500) return null;
    const text = pickMainText(html);
    return text.length >= 80 ? text : null;
  } catch {
    return null;
  }
}

export async function enrichContent(items: Array<{ id: string; item: RawItem }>): Promise<Array<{ id: string; item: RawItem }>> {
  const rawItems = items.map((r) => r.item);
  const needsFetch = rawItems.filter(
    (it) => !it.articleContent && it.url && !shouldSkipUrl(it.url),
  );
  if (needsFetch.length === 0) return items;

  const map = new Map<string, string | null>();
  const limit = pLimit(4);
  const results = await Promise.all(
    needsFetch.map((it) =>
      limit(() => fetchBody(it.url!)).then((body) => [it.url!, body] as const),
    ),
  );
  for (const [url, body] of results) map.set(url, body);

  let enriched = 0;
  for (const it of rawItems) {
    if (!it.articleContent && it.url && map.has(it.url)) {
      it.articleContent = map.get(it.url) ?? undefined;
      if (it.articleContent) enriched++;
    }
  }
  console.log(`  [enrich] fetched=${enriched} of ${needsFetch.length} title-only items`);
  return items;
}