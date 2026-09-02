/**
 * sample-insight.ts —— Phase 1 质检门：挑 2-3 条真实待摘要文章，
 * 跑新版 Summarize v4 Prompt，把 LLM 输出原样打印，供人工判定。
 *
 * 关键约束：只读不写。不标记 articles 已摘要，不写任何新字段到 DB。
 * 如果 DB 里没有未摘要的文章，退回到已摘要的文章（标记 dry 模式），让 prompt 重跑一次。
 *
 * 用法：
 *   tsx pipeline/scripts/sample-insight.ts [N=3]   抽样 N 条
 *   BACKFILL_INSIGHT_FORCE_READ=true 强制走已摘要文章（dry 模式）
 */
import "../src/env";
import { getDb, ensureSchema } from "../src/db";
import {
  runModel,
  parseModelJson,
  computeResult,
  buildInsightUserContent,
} from "../src/summarize";

interface Article {
  id: string;
  title: string;
  titleZh: string | null;
  sourceName: string;
  content: string | null;
  summary: string | null;
  publishedAt: string;
}

const N = Math.min(5, Number(process.argv[2] ?? 3));
const forceDry = process.env.BACKFILL_INSIGHT_FORCE_READ === "true";

async function pickArticles(limit: number, dry = false): Promise<Article[]> {
  const db = await getDb();
  let rs: { rows: any[] };
  if (dry) {
    rs = await db.execute({
      sql: `SELECT a.id, a.title, a.title_zh, s.name AS source_name,
                  a.article_content, a.summary, a.published_at
           FROM articles a
           LEFT JOIN sources s ON s.id = a.source_id
           WHERE (a.article_content IS NOT NULL OR a.summary IS NOT NULL)
             AND length(COALESCE(a.article_content, a.summary)) >= 400
           ORDER BY a.published_at DESC
           LIMIT ?`,
      args: [limit],
    });
  } else {
    rs = await db.execute({
      sql: `SELECT a.id, a.title, a.title_zh, s.name AS source_name,
                  a.article_content, a.summary, a.published_at
           FROM articles a
           LEFT JOIN sources s ON s.id = a.source_id
           WHERE a.summary IS NULL AND a.summarized_at IS NULL
             AND a.article_content IS NOT NULL
             AND length(a.article_content) >= 400
           ORDER BY a.published_at DESC
           LIMIT ?`,
      args: [limit],
    });
  }
  return rs.rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    titleZh: r.title_zh == null ? null : String(r.title_zh),
    sourceName: r.source_name == null ? "(unknown)" : String(r.source_name),
    content: r.article_content == null ? null : String(r.article_content),
    summary: r.summary == null ? null : String(r.summary),
    publishedAt: String(r.published_at),
  }));
}

function printArticle(a: Article, idx: number, mode: string): void {
  console.log(
    `\n${"=".repeat(90)}\n` +
    `#${idx} [${mode}]  ${a.publishedAt}\n` +
    `标题：${a.titleZh || a.title}\n` +
    `来源：${a.sourceName}\n` +
    `正文长度：${(a.content || "").length} 字\n` +
    `${"=".repeat(90)}`,
  );
}

function summarizeBlock(label: string, val: string | null | undefined, max = 140): string {
  if (val == null || val.length === 0) return "";
  const s = typeof val === "string" ? val : String(val);
  const t = s.length > max ? s.slice(0, max) + "…" : s;
  return `  ${label}：${t}`;
}

async function sample(): Promise<void> {
  await ensureSchema();
  let articles = await pickArticles(N, forceDry);
  if (articles.length === 0 && !forceDry) {
    console.log(
      "[sample] 本地 DB 没有未摘要文章，退回已摘要文章做 dry-run 复核…",
    );
    articles = await pickArticles(N, true);
  }
  if (articles.length === 0) {
    console.error("[sample] 本地 DB 完全无文章可抽样，无法执行。");
    process.exit(2);
  }

  const mode = forceDry ? "dry-run（重跑已摘要文章）" : "首次摘要（写库前预览）";
  console.log(`\n[sample] 抽样 ${articles.length} 条，模式：${mode}\n`);

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    printArticle(a, i + 1, mode);

    const row = {
      id: a.id,
      title: a.title,
      titleZh: a.titleZh,
      sourceName: a.sourceName,
      content: a.content,
      authority: 60,
    };

    try {
      const userContent = await buildInsightUserContent(row);
      const raw = await runModel(userContent);
      const parsed = raw ? parseModelJson(raw) : null;
      if (!parsed) {
        console.log(`  ⚠️  LLM 未返回合法 JSON（raw 长度=${raw?.length ?? 0}）：`);
        console.log(`     尾部 120 字：…${(raw || "(空)").slice(-120)}`);
        console.log(`     完整 raw：\n${raw || "(空)"}`);
        continue;
      }
      const result = computeResult(row, parsed, null);

      // 展示 LLM 关键输出 —— 供人工判定"推理链 vs 五段 AI 文字"
      console.log("【LLM 原始输出（前 800 字）】");
      console.log(`  ${raw.slice(0, 800)}\n`);
      console.log("【结构化五板块推理链】");
      console.log(summarizeBlock("① AI 洞察 (insight)", result.summary ?? "(null)", 260));
      console.log(summarizeBlock("② 核心结论 (key_change)", result.keyChange ?? "(null)", 140));
      console.log(summarizeBlock("③ 为什么重要 (why_it_matters)", result.whyItMatters ?? "(null)", 200));
      if (result.impact) {
        try {
          const parsedImpact = JSON.parse(result.impact);
          parsedImpact.forEach((it: any, k: number) => {
            console.log(
              `  ④ 影响谁 [${k + 1}]：${it.audience} → ${it.direction ?? "(?)"} ｜ ${it.description || ""}`,
            );
          });
        } catch {
          console.log(`  ④ 影响谁（原始）：${result.impact.slice(0, 200)}`);
        }
      }
      console.log(summarizeBlock("⑤ 后续看点 (forward_signal)", result.forwardSignal ?? "(null)", 220));
      console.log(`  洞察等级：L${result.insightLevel ?? "?"}`);
      const tc = Array.isArray(result.topicCategory) ? result.topicCategory : [];
      console.log(`  topic_category：${tc.length > 0 ? tc.join(", ") : "(null)"}`);
      const fl = Array.isArray(result.fact) ? result.fact.length : 0;
      const il = Array.isArray(result.inference) ? result.inference.length : 0;
      const sl = Array.isArray(result.speculation) ? result.speculation.length : 0;
      console.log(`  fact：${fl} 条 ｜ inference：${il} 条 ｜ speculation：${sl} 条`);
      console.log(`  score: relevance=${result.relevance} quality=${result.quality} impact=${result.impactScore} importance=${result.importanceScore} final=${result.final}`);
      console.log("\n  ── 人工判定：推理链 ✓  还是  标题扩写 ✗  ──\n");
    } catch (err) {
      console.error(`  ❌ 失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log("\n[sample] 完成。以上为人工质检输入，请判定：推理链 ✓ 还是 标题扩写 ✗");
}

sample().catch((err) => {
  console.error(err);
  process.exit(1);
});