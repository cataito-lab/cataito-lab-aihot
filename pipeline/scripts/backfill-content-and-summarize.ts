/**
 * backfill-content-and-summarize.ts
 *
 * 目的：对近期正文过短（< MIN_BODY_CHARS）因而被摘要链路判为"无有效正文"的文章，
 * 抓源文正文回写 DB，然后调 LLM 生成 5 维 AI 洞察。
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
 * - 正文抓取逻辑与主链路共用 pipeline/src/enrich-content.ts，避免两处实现漂移
 */
import "../src/env";
import { getDb, getSummaryTier, setArticleContent } from "../src/db";
import { summarizePending } from "../src/summarize";
import { fetchBody, shouldSkipUrl, MIN_BODY_CHARS } from "../src/enrich-content";

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

async function main() {
  const { limit, hours, dryRun } = parseArgs();
  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString();

  // 筛选条件是「正文缺失或短于生成门槛」，不只是 IS NULL/''：
  // 中文 RSS 的 description 常见 20-79 字一句导语，只判空会整批漏掉。
  // 同时必须带 summarized_at IS NULL：第二步走的就是这个谓词的队列查询，
  // 否则会把存量黑洞行（已置 summarized_at、五维全 null）抓一遍正文却零条生成 = 假绿。
  // 那批行要回炉得先决定是重置 summarized_at 还是新建重算入口，不在本脚本射程内。
  const rs = await getDb().execute({
    sql: `SELECT a.id, a.url
          FROM articles a
          WHERE (a.article_content IS NULL OR LENGTH(a.article_content) < ?)
            AND a.summarized_at IS NULL
            AND a.url IS NOT NULL
            AND a.published_at >= ?
          ORDER BY a.published_at DESC
          LIMIT ?`,
    args: [MIN_BODY_CHARS, cutoff, limit],
  });
  const rows = Array.from(rs.rows).map((r) => ({
    id: String(r.id),
    url: String(r.url),
  }));
  console.log(`[backfill] ${rows.length} articles with short/missing content (cutoff=${cutoff}, minChars=${MIN_BODY_CHARS})`);

  const toFetch = rows.filter((r) => !shouldSkipUrl(r.url));
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
          await setArticleContent(r.id, body);
          enriched++;
        }
      }));
    }
  }
  console.log(`[backfill] enriched ${enriched}/${toFetch.length}`);

  // 第二步：对已 enriched 的文章调 LLM 摘要（复用既有查询函数，类型对齐）
  if (!dryRun && enriched > 0) {
    const shape = await getSummaryTier({ newerThanHours: hours, limit: 30 });
    console.log(`[backfill] ${shape.length} articles ready for LLM`);

    const done = (await summarizePending(shape)).done;
    console.log(`[backfill] summarized ${done}`);
  } else if (dryRun) {
    console.log("[backfill] dry-run, no writes");
  }
  console.log("[backfill] done");
}

main().catch((e) => { console.error(e); process.exit(1); });