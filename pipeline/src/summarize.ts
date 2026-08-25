import { countSummariesToday, markSummarized } from "./db";
import type { SummarizeResultV2 } from "./db";
import { httpFetch } from "./net";

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";

const MODEL = process.env.CF_AI_MODEL ?? "@cf/meta/llama-3.1-70b-instruct";
const DAILY_QUOTA = 500;
const MAX_PER_RUN = 30;

// Summarize v2：一次调用产出 摘要 + WHY + 三维评分（0-100）。
// 硬规则：禁止复述标题；原文没有的信息不得编造；营销/预告类内容 impact 封顶。
const SYSTEM_PROMPT = `你是 AI 行业新闻编辑，处理一条新闻并输出 JSON（不要输出其他内容）。
JSON 格式：
{"summary":"不超过60字的中文摘要","why":"不超过40字的中文：这件事为什么值得关注","relevance":0-100,"quality":0-100,"impact":0-100}

各字段要求：
- summary：只能依据正文摘录中的事实撰写，标题仅用于理解主题、不得作为事实来源。必须包含正文中有而标题没有的信息（具体变化/关键数据/影响对象）。只是把标题换成另一种说法 = 失败。正文没有的信息（数据、日期、性能数字、背景）一律不得出现在摘要里。
- why：基于正文事实说明这条新闻为什么值得关注（行业格局/竞争/对谁有影响）。正文不足以支撑判断则写"行业影响有限"。
- relevance：与 AI 主题的核心程度。100=核心 AI 内容（模型/Agent/研究/政策），30=只顺带提到 AI。
- quality：正文的信息质量。100=有具体事实、数据、日期；20=营销稿/标题党/空话。
- impact：对 AI 行业的影响面。100=影响全行业的里程碑；60=重要产品或研究；30=常规更新；10=营销活动。

标题含"直播/预告/优惠/报名/招聘/抽奖"等营销词时，impact 不得超过 30。`;

/** 正文低于此长度视为"无有效正文"——没有事实依据就不生成摘要（一切以事实为依据） */
const MIN_CONTENT_CHARS = 80;

const PROMO_TITLE_RE = /(直播|预告|优惠|报名|招聘|抽奖|优惠券|免费领)/;

export interface SummarizableRow {
  id: string;
  title: string;
  titleZh: string | null;
  sourceName: string;
  content: string | null;
  authority: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampScore(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function parseModelJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function runModel(userContent: string): Promise<string | null> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_AI_API_TOKEN;
  if (!accountId || !token) return null;
  const res = await httpFetch(`${API_BASE}/${accountId}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 500,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Workers AI HTTP ${res.status}`);
  const data = (await res.json()) as { result?: { response?: unknown } };
  const out = data.result?.response;
  // CF 部分模型偶发返回字符串数组，归一化为字符串
  const text =
    typeof out === "string"
      ? out.trim()
      : Array.isArray(out)
        ? out
            .map((c) =>
              typeof c === "string" ? c : String((c as { response?: string })?.response ?? ""),
            )
            .join("")
            .trim()
        : "";
  return text || null;
}

function computeResult(
  row: SummarizableRow,
  parsed: Record<string, unknown> | null,
  fallbackSummary: string | null,
): SummarizeResultV2 {
  if (!parsed) {
    // 兼容降级：模型未返回结构化 JSON 时，只保留纯摘要文本，不打分
    return {
      summary: fallbackSummary,
      why: null,
      relevance: null,
      quality: null,
      impact: null,
      final: null,
    };
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() || null : null;
  const why = typeof parsed.why === "string" ? parsed.why.trim() || null : null;
  const relevance = clampScore(parsed.relevance);
  const quality = clampScore(parsed.quality);
  let impact = clampScore(parsed.impact);
  if (impact != null && PROMO_TITLE_RE.test(row.title)) impact = Math.min(impact, 30);

  let final: number | null = null;
  if (relevance != null && quality != null && impact != null) {
    const authority = Math.max(0, Math.min(100, row.authority || 60));
    final = Math.round(0.2 * relevance + 0.2 * authority + 0.25 * quality + 0.35 * impact);
  }
  return { summary: summary ?? fallbackSummary, why, relevance, quality, impact, final };
}

export async function summarizePending(rows: SummarizableRow[]): Promise<number> {
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_AI_API_TOKEN) {
    console.log("  [summarize] skipped (CF_ACCOUNT_ID / CF_AI_API_TOKEN not set)");
    return 0;
  }

  const usedToday = await countSummariesToday();
  let remainingQuota = Math.max(0, DAILY_QUOTA - usedToday);
  let done = 0;
  let scored = 0;
  let failures = 0;
  let noContent = 0;

  for (const row of rows) {
    if (done >= MAX_PER_RUN || remainingQuota <= 0) break;

    // 无有效正文 = 没有事实依据：不调用模型、不生成摘要（凭标题写摘要就是瞎猜）。
    // 标记为已处理（无摘要无评分），前端按"未评分保底展示"规则照常显示标题。
    if (!row.content || row.content.length < MIN_CONTENT_CHARS) {
      await markSummarized(row.id, {
        summary: null,
        why: null,
        relevance: null,
        quality: null,
        impact: null,
        final: null,
      });
      noContent++;
      continue;
    }

    try {
      const parts = [`标题：${row.titleZh ?? row.title}`];
      if (row.titleZh && row.titleZh !== row.title) parts.push(`原标题：${row.title}`);
      parts.push(`来源：${row.sourceName}`);
      parts.push(`正文摘录：${row.content}`);
      const raw = await runModel(parts.join("\n"));
      const parsed = raw ? parseModelJson(raw) : null;

      if (!parsed && !raw) {
        // 模型返回空内容：不计入配额、不标记已处理，留待下轮重试
        console.warn(`  [summarize] ${row.id}: empty response, skipped`);
        failures++;
        await sleep(100);
        continue;
      }

      // 兼容降级：非 JSON 输出按纯文本摘要处理（旧版行为）
      const fallback = parsed ? null : raw!;
      const result = computeResult(row, parsed, fallback);
      const valid = result.summary != null;
      if (!valid) {
        // 无法从输出中提取摘要：不标记，留待重试
        console.warn(`  [summarize] ${row.id}: no usable summary in response, skipped`);
        failures++;
        await sleep(100);
        continue;
      }
      await markSummarized(row.id, result);
      done++;
      remainingQuota--;
      if (result.final != null) scored++;
    } catch (err) {
      console.warn(`  [summarize] ${row.id}: ${err instanceof Error ? err.message : err}`);
      failures++;
      if (failures >= 5) break;
      await sleep(100);
      continue;
    }
    await sleep(100);
  }

  console.log(
    `  [summarize] model=${MODEL} summarized=${done} scored=${scored} failed=${failures} noContent=${noContent} quotaLeft=${remainingQuota}`,
  );
  return done;
}
