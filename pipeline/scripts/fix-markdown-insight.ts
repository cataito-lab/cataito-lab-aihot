/**
 * fix-markdown-insight.ts —— 一次性清洗「markdown 报告泄漏」脏洞察。
 *
 * 背景：某些 provider 忽略 response_format（json 模式）时，模型把 JSON schema 渲染成
 * markdown 报告（### 分节、字段标签、表格），旧兜底逻辑把整坨 markdown 当纯摘要写进了
 * summary，直接显示在页面上。summarize.ts 已加固不再落库此类输出；本脚本清理历史脏行。
 *
 * 做法：命中 looksLikeProseLeak 的行，把整组洞察字段 + 多语译列回退为 NULL，
 * 清 summarized_at 让正常 pipeline（getSummaryBacklog / getRecentWithoutSummary）重新生成，
 * 清 *_ja/es/fr 让 translate 工作流重新翻译。脚本本身不调用模型、不产生新洞察。
 *
 * 用法：
 *   npx tsx pipeline/scripts/fix-markdown-insight.ts --dry-run   # 只列出命中行，不写库
 *   npx tsx pipeline/scripts/fix-markdown-insight.ts             # 执行回退
 *
 * 生产库操作请在 GitHub Actions 中触发（见 .github/workflows/fix-markdown-insight.yml），
 * 不要本地直连生产。
 */
import "../src/env";
import { getDb, ensureSchema } from "../src/db";
import { looksLikeProseLeak } from "../src/summarize";

const dry = process.argv.includes("--dry-run");

// SQL 预筛（LIKE 粗筛）+ JS 端 looksLikeProseLeak 精判，避免误伤正常摘要。
const PREFILTER = `summary IS NOT NULL AND (
       summary LIKE '%###%'
    OR summary LIKE '%insight_level%'
    OR summary LIKE '%importance_score%'
    OR summary LIKE '%impact_score%'
    OR summary LIKE '%event_key%'
    OR summary LIKE '%topic_category%'
    OR summary LIKE '%forward_signal%'
    OR summary LIKE '%why_it_matters%'
    OR summary LIKE '%key_change%'
  )`;

interface CandidateRow {
  id: string;
  title: string;
  summary: string;
}

async function getCandidates(): Promise<CandidateRow[]> {
  const db = await getDb();
  const rs = await db.execute({
    sql: `SELECT id, title, summary FROM articles WHERE ${PREFILTER} ORDER BY published_at DESC`,
    args: [],
  });
  return rs.rows.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    summary: String(r.summary ?? ""),
  }));
}

// 回退列：markSummarized 会重写 base + _en 列，translate 工作流会重写 _ja/es/fr 列。
// insight_level / insight_reviewed 有 NOT NULL 约束，回退为默认值而非 NULL。
const RESET_COLS = [
  "summary", "summary_en", "summary_ja", "summary_es", "summary_fr",
  "key_change", "key_change_en", "key_change_ja", "key_change_es", "key_change_fr",
  "why_it_matters", "why_it_matters_en",
  "forward_signal", "forward_signal_en", "forward_signal_ja", "forward_signal_es", "forward_signal_fr",
  "impact", "impact_en", "impact_ja", "impact_es", "impact_fr",
  "category", "category_en",
  "score_relevance", "score_quality", "score_impact", "score_final", "importance_score",
  "event_key", "entities",
  "insight_pass",
  "insight_review_score_info_gain", "insight_review_score_evidence",
  "insight_review_score_specificity", "insight_review_score_interpretation",
  "fact", "inference", "speculation", "fact_sources", "topic_category",
  "summarized_at",
];

async function resetRow(id: string): Promise<void> {
  const db = await getDb();
  const setSql =
    RESET_COLS.map((c) => `${c} = NULL`).join(", ") +
    ", insight_level = 1, insight_reviewed = 0";
  await db.execute({ sql: `UPDATE articles SET ${setSql} WHERE id = ?`, args: [id] });
}

async function main(): Promise<void> {
  await ensureSchema();
  const candidates = await getCandidates();
  const dirty = candidates.filter((c) => looksLikeProseLeak(c.summary));

  console.log(`[fix-markdown] 预筛命中=${candidates.length} 精判脏行=${dirty.length} dry=${dry}`);
  for (const c of dirty.slice(0, 20)) {
    console.log(`  - ${c.id}: ${c.title.slice(0, 40)} | summary 前 60 字: ${c.summary.slice(0, 60).replace(/\n/g, " ")}`);
  }
  if (dirty.length > 20) console.log(`  … 其余 ${dirty.length - 20} 条略`);

  if (dry) {
    console.log("[fix-markdown] dry-run，未写库。");
    return;
  }

  let n = 0;
  for (const c of dirty) {
    await resetRow(c.id);
    n++;
  }
  console.log(`[fix-markdown] 已回退 ${n} 行，等待 pipeline 重新生成洞察。`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
