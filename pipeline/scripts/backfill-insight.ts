/**
 * backfill-insight.ts —— 用新版「AI Insight 智能洞察」提示词，对历史文章重算结构化洞察。
 *
 * 设计：
 * - 只处理 `importance_score IS NULL` 的文章（即 P0 之前的文章尚未用新提示词生成过
 *   含重要度评分/实体的完整洞察；已用新提示词的文章 importance_score 非空，会跳过）。
 * - 正文缺失时回退用旧 summary 作为上下文（与 backfill-history 同样的兜底思路）。
 * - 每次运行受 BACKFILL_INSIGHT_MAX（默认 180）上限保护，避免击穿 Cloudflare 每日神经元额度。
 * - 处理完成后（pending 归零）自动重聚类（wipe events + reset event_id + clusterEvents），
 *   保证新提示词产出的 event_key 与既有聚类一致；可用 --no-recluster 跳过。
 * - --dry-run 只统计待处理数量，不调用模型、不写库。
 *
 * 用法：
 *   tsx pipeline/scripts/backfill-insight.ts            # 跑一批（上限内）
 *   tsx pipeline/scripts/backfill-insight.ts --dry-run  # 只看数量
 */
import "dotenv/config";
import { getDb, markSummarized, ensureSchema } from "../src/db";
import { runModel, parseModelJson, computeResult, buildInsightUserContent } from "../src/summarize";
import { clusterEvents } from "../src/cluster";

const MAX_CALLS = Number(process.env.BACKFILL_INSIGHT_MAX ?? 180);
const BIG_WINDOW = 24 * 365 * 10;
const dry = process.argv.includes("--dry-run");
const noRecluster = process.argv.includes("--no-recluster");

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function main(): Promise<void> {
  await ensureSchema();
  const pending = await getPending();
  console.log(`[insight] pending=${pending.length} max=${MAX_CALLS} dry=${dry}`);
  if (dry) return;

  let done = 0;
  let failures = 0;
  let consecutive429 = 0;
  for (const r of pending) {
    if (done >= MAX_CALLS) break;
    const content = r.article_content ?? r.summary ?? r.summary_en ?? r.title;
    if (!content) continue;
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
        failures++;
        console.warn(`  [insight] ${r.id}: empty model response`);
        await sleep(150);
        continue;
      }
      const parsed = parseModelJson(raw);
      const looksLikeJson = raw.trimStart().startsWith("{");
      const fallback = !parsed && !looksLikeJson ? raw : null;
      const result = computeResult(row, parsed, fallback);
      if (result.summary == null) {
        failures++;
        console.warn(`  [insight] ${r.id}: no usable summary in response`);
        await sleep(150);
        continue;
      }
      await markSummarized(r.id, result);
      // 旧的多语译文是基于旧 summary 翻译的，置空让其重新从新洞察翻译
      await getDb().execute({
        sql: "UPDATE articles SET summary_ja = NULL, summary_es = NULL, summary_fr = NULL WHERE id = ?",
        args: [r.id],
      });
      done++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429")) {
        consecutive429++;
        console.warn(`  [insight] ${r.id}: ${msg}`);
        if (consecutive429 >= 3) {
          console.log("[insight] 连续 3 次 429：判定 Workers AI 每日额度耗尽，提前退出（UTC 00:00 重置后再跑）");
          break;
        }
      } else {
        consecutive429 = 0;
        failures++;
        console.warn(`  [insight] ${r.id}: ${msg}`);
      }
    }
    await sleep(150);
  }

  console.log(`[insight] done=${done} failures=${failures}`);

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
