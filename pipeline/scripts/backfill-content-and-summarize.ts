/**
 * backfill-content-and-summarize.ts
 *
 * 目的：对近期 article_content 为空且未摘要的文章，抓源文正文回写 DB，
 * 然后调 LLM 生成 5 维 AI 洞察。
 *
 * 触发方式：本地 dev 或 GitHub Actions（需要 TURSO_* + SENSENOVA_* / CF_* 凭证）。
 *
 * 用法：
 *   npx tsx pipeline/scripts/backfill-content-and-summarize.ts          # 跑一批
 *   npx tsx pipeline/scripts/backfill-content-and-summarize.ts --limit=30 --hours=168
 *   npx tsx pipeline/scripts/backfill-content-and-summarize.ts --dry-run
 *
 * 设计：
 * - 只处理近 --hours 内的文章，避免回补过老内容
 * - 跳过明确无独立正文的 URL（HN 评论页 / Twitter / Reddit 评论页）
 * - enrich 与 summarize 各跑一轮；summarize 走现有 quota 与 fallback 逻辑
 */
import "../src/env";
import { getDb, getRecentWithoutSummary } from "../src/db";
import { summarizePending } from "../src/summarize";

function parseArgs() {
  let limit = 80;
  let hours = 72;
  let dryRun = false;
  for (const a of process.argv.slice(2)) {
    const mL = a.match(/^--limit=(\d+)$/);
    const mH = a.match(/^--hours=(\d+)$/);
    if (mL) { limit = Number(mL[1]); continue; }
    if (mH) { hours = Number(mH[1]); continue; }
    if (a === "--dry-run") dryRun = true;
  }
  return { limit, hours, dryRun };
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ai-news-pipeline/0.1";
const SKIP_RE = new RegExp(
  "^(https?:\\/\\/)?(news\\.ycombinator\\.com\\/item\\?id=|twitter\\.com\\/|x\\.com\\/|reddit\\.com\\/r\\/[^\\/]+\\/comments\\/)",
);
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

function pickMainText(html: string): string {
  const container =
    html.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ??
    html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[2] ??
    html;
  const paras = container.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
  const texts = paras.map((p) => stripHtml(p)).filter((t) => t.length > 40);
  let out = "";
  for (const t of texts) {
    if (out.length + t.length > MAX_BODY_CHARS) break;
    out += t + " ";
  }
  if (out.length < 200) out = stripHtml(container).slice(0, MAX_BODY_CHARS);
  return out.slice(0, MAX_BODY_CHARS).trim();
}

async function fetchBody(url: string): Promise<string | null> {
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
      },
      signal: controller.signal,
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

async function main() {
  const { limit, hours, dryRun } = parseArgs();
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();

  const rs = await getDb().execute({
    sql: `SELECT a.id, a.url
          FROM articles a
          WHERE (a.article_content IS NULL OR a.article_content='')
            AND a.url IS NOT NULL
            AND a.published_at >= ?
          ORDER BY a.published_at DESC
          LIMIT ?`,
    args: [cutoff, limit],
  });
  const rows = Array.from(rs.rows).map((r) => ({
    id: String(r.id),
    url: String(r.url),
  }));
  console.log(`[backfill] ${rows.length} articles without content (cutoff=${cutoff})`);

  const toFetch = rows.filter((r) => !SKIP_RE.test(r.url));
  console.log(`[backfill] ${toFetch.length} fetchable, ${rows.length - toFetch.length} skipped`);

  let enriched = 0;
  if (toFetch.length > 0 && !dryRun) {
    // 串行带并发控制：每次 4 个并行抓取
    const CONCURRENCY = 4;
    const queue = [...toFetch];
    while (queue.length > 0) {
      const batch = queue.splice(0, CONCURRENCY);
      await Promise.all(batch.map(async (r) => {
        const body = await fetchBody(r.url);
        if (body) {
          await getDb().execute({
            sql: `UPDATE articles SET article_content = ? WHERE id = ?`,
            args: [body, r.id],
          });
          enriched++;
        }
      }));
    }
  }
  console.log(`[backfill] enriched ${enriched}/${toFetch.length}`);

  // 第二步：对已 enriched 的文章调 LLM 摘要（复用既有查询函数，类型对齐）
  if (!dryRun && enriched > 0) {
    const shape = await getRecentWithoutSummary(hours, 30);
    console.log(`[backfill] ${shape.length} articles ready for LLM`);

    const done = await summarizePending(shape);
    console.log(`[backfill] summarized ${done}`);
  } else if (dryRun) {
    console.log("[backfill] dry-run, no writes");
  }
  console.log("[backfill] done");
}

main().catch((e) => { console.error(e); process.exit(1); });