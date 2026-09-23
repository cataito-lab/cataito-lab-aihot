/**
 * backfill-insight.ts —— 用新版「AI Insight 智能洞察」提示词，对历史文章重算结构化洞察。
 *
 * 设计：
 * - 只处理 `importance_score IS NULL` 的文章（即 P0 之前的文章尚未用新提示词生成过
 *   含重要度评分/实体的完整洞察；已用新提示词的文章 importance_score 非空，会跳过）。
 * - 正文缺失时回退用旧 summary 作为上下文（与 backfill-history 同样的兜底思路）。
 * - 并发池处理（默认 CONCURRENCY=5），吞吐约 5× 串行；每次运行受 BACKFILL_INSIGHT_MAX
 *   （默认 400）上限保护，避免击穿网关速率或跑超时。
 * - 处理完成后（pending 归零）自动重聚类（wipe events + reset event_id + clusterEvents），
 *   保证新提示词产出的 event_key 与既有聚类一致；可用 --no-recluster 跳过。
 * - --dry-run 只统计待处理数量，不调用模型、不写库。
 *
 * 用法：
 *   tsx pipeline/scripts/backfill-insight.ts            # 跑一批（上限内）
 *   tsx pipeline/scripts/backfill-insight.ts --dry-run  # 只看数量
 */
import "../src/env";
import pLimit from "p-limit";
import { getDb, markSummarized, ensureSchema } from "../src/db";
import { runModel, parseModelJson, computeResult, buildInsightUserContent, looksLikeProseLeak } from "../src/summarize";
import { clusterEvents } from "../src/cluster";

const MAX_CALLS = Number(process.env.BACKFILL_INSIGHT_MAX ?? 400);
const CONCURRENCY = Number(process.env.BACKFILL_INSIGHT_CONCURRENCY ?? 5);
const BIG_WINDOW = 24 * 365 * 10;
const dry = process.argv.includes("--dry-run");
const noRecluster = process.argv.includes("--no-recluster");

/**
 * 429 保护阈值：并发池中，自上次成功以来累积 429 次数超过此阈值则中止。
 * 设为 CONCURRENCY 的 2 倍，容忍少量并发 429 后自动恢复；
 * 连续超阈值说明网关已全面限流，再跑也没用。
 */
const ABORT_429_THRESHOLD = CONCURRENCY * 2;

interface PendingRow {
  id: string;
  title: string;
  title_zh: string | null;
  article_content: string | null;
  summary: string | null;
  summary_en: string | null;
  source_name: string | null;
  authority: number | null;
}

async function getPending(): Promise<PendingRow[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT a.id, a.title, a.title_zh, a.article_content, a.summary, a.summary_en, s.name AS source_name, s.authority AS authority
          FROM articles a
          LEFT JOIN sources s ON s.id = a.source_id
          WHERE a.importance_score IS NULL AND (a.article_content IS NOT NULL OR a.summary IS NOT NULL OR a.summary_en IS NOT NULL OR a.title IS NOT NULL)
          ORDER BY a.published_at ASC`,
    args: [],
  });
  return rs.rows as unknown as PendingRow[];
}

async function recluster(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM events");
  await db.execute("UPDATE articles SET event_id = NULL");
  const r = await clusterEvents(BIG_WINDOW);
  console.log(`[recluster] clustered=${r.clustered} synthesized=${r.synthesized}`);
}

async function processOne(r: PendingRow): Promise<'ok' | 'fail' | '429' | 'skip'> {
  const content = r.article_content ?? r.summary ?? r.summary_en ?? r.title;
  if (!content) return 'skip';
  const row = {
    id: r.id,
    title: r.title,
    titleZh: r.title_zh,
    sourceName: r.source_name ?? r.id,
    content,
    authority: r.authority ?? 60,
  };
  try {
    const userContent = await buildInsightUserContent(row);
    const raw = await runModel(userContent);
    if (!raw) {
      console.warn(`  [insight] ${r.id}: empty model response`);
      return 'fail';
    }
    const parsed = parseModelJson(raw);
    const looksLikeJson = raw.trimStart().startsWith("{");
    // provider 忽略 json 模式时模型吐 markdown 报告，不许当摘要落库；判 fail 留待下轮重试
    const proseLeak = !parsed && looksLikeProseLeak(raw);
    if (proseLeak) console.warn(`  [insight] ${r.id}: 非 JSON 的结构化散文泄漏，本轮不落库`);
    const fallback = !parsed && !looksLikeJson && !proseLeak ? raw : null;
    const result = computeResult(row, parsed, fallback);
    if (result.summary == null) {
      console.warn(`  [insight] ${r.id}: no usable summary in response`);
      return 'fail';
    }
    await markSummarized(r.id, result);
    // 旧的多语译文是基于旧 summary 翻译的，置空让其重新从新洞察翻译
    await getDb().execute({
      sql: "UPDATE articles SET summary_ja = NULL, summary_es = NULL, summary_fr = NULL WHERE id = ?",
      args: [r.id],
    });
    return 'ok';
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429")) {
      console.warn(`  [insight] ${r.id}: ${msg}`);
      return '429';
    }
    console.warn(`  [insight] ${r.id}: ${msg}`);
    return 'fail';
  }
}

async function main(): Promise<void> {
  await ensureSchema();
  const pending = await getPending();
  const batch = pending.slice(0, MAX_CALLS);
  console.log(`[insight] pending=${pending.length} batch=${batch.length} max=${MAX_CALLS} concurrency=${CONCURRENCY} dry=${dry}`);
  if (dry) return;

  let done = 0;
  let failures = 0;
  let hit429SinceLastSuccess = 0;
  let aborted = false;

  const limit = pLimit(CONCURRENCY);
  const tasks = batch.map((r) =>
    limit(async () => {
      if (aborted) return;
      const outcome = await processOne(r);
      switch (outcome) {
        case 'ok':
          done++;
          hit429SinceLastSuccess = 0;
          break;
        case '429':
          hit429SinceLastSuccess++;
          if (hit429SinceLastSuccess >= ABORT_429_THRESHOLD) {
            console.log(`[insight] 累积 ${hit429SinceLastSuccess} 次 429 无成功：判定网关限流，中止剩余任务`);
            aborted = true;
          }
          break;
        case 'fail':
          failures++;
          hit429SinceLastSuccess = 0; // non-429 failure resets the 429 streak
          break;
        case 'skip':
          break;
      }
    }),
  );

  await Promise.all(tasks);

  console.log(`[insight] done=${done} failures=${failures} aborted=${aborted}`);

  const leftRs = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM articles WHERE importance_score IS NULL AND (article_content IS NOT NULL OR summary IS NOT NULL OR summary_en IS NOT NULL OR title IS NOT NULL)`,
    args: [],
  });
  const left = Number(((leftRs.rows[0] as Record<string, unknown>).n as unknown) ?? 0);
  if (left === 0 && !noRecluster) {
    console.log("[insight] 全部完成，重新聚类...");
    await recluster();
  } else {
    console.log(`[insight] 剩余 ${left} 篇，跳过重聚类（下次继续）`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
