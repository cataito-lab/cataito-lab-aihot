import { countSummariesToday, markSummarized } from "./db";
import type { SummarizeResultV3 } from "./db";
import { httpFetch } from "./net";

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";

const MODEL = process.env.CF_AI_MODEL ?? "@cf/meta/llama-3.1-70b-instruct";
const DAILY_QUOTA = 200;
const MAX_PER_RUN = 30;

// Summarize v3：一段式摘要（事实→核心变化→行业意义）+ 要点 + 行业影响 + 三维评分。
// 硬规则：禁止复述标题；只依据正文事实；原文没有的信息不得编造；营销/预告类 impact 封顶。
const SYSTEM_PROMPT = `你是 AI 行业新闻编辑，处理一条新闻并输出 JSON（不要输出其他内容）。
JSON 格式：
{"summary":"80-100字的中文一段式摘要","key_points":["要点1","要点2","要点3"],"industry_impact":"一句话：对行业/企业/用户的影响","relevance":0-100,"quality":0-100,"impact":0-100,"event_key":"规范化英文事件slug(小写连字符、≤5词、无单一事件则留空字符串)","entities":["实体1","实体2"]}

各字段要求：
- summary：一段流畅的中文，三句话结构：第一句陈述核心事实，第二句点出与以往不同的关键变化，第三句说明行业意义。禁止复述标题——只把标题换一种说法 = 失败。只能依据正文摘录中的事实，正文没有的数据、日期、性能数字一律不得出现；信息不足时如实说明。
- key_points：恰好 3 条，每条 ≤20 字，提取正文中的具体事实（数据/日期/功能/价格/涉及方）。
- industry_impact：一句话说明对行业、企业或用户的影响。
- relevance：与 AI 主题的核心程度。100=核心 AI 内容，30=只顺带提到 AI。
- quality：正文信息质量。100=有具体事实、数据、日期；20=营销稿/标题党/空话。
  - impact：对 AI 行业的影响面。100=影响全行业的里程碑；60=重要产品或研究；30=常规更新；10=营销活动。
  - event_key：若该新闻指向一个具体、可独立描述的事件（发布/发布模型/收购/研究突破/融资/监管动作等），给出规范化英文 slug：小写、连字符分隔、≤5 个词、只含 a-z0-9-，例如 "openai-gpt5-release"、"anthropic-claude-4-launch"。同一事件的不同媒体、不同语言报道必须输出完全相同的 event_key（这是跨源聚类的唯一依据）。若是观点/评论/综述/教程、或没有单一事件，输出空字符串 ""。
  - entities：提取 ≤5 个最关键实体（机构/产品/人物/技术），用于聚类兜底与展示，例如 ["OpenAI","GPT-5"]。


标题含"直播/预告/优惠/报名/招聘/抽奖"等营销词时，impact 不得超过 30。`;

const PROMO_TITLE_RE = /(直播|预告|优惠|报名|招聘|抽奖|优惠券|免费领)/;

/** 正文低于此长度视为"无有效正文"——没有事实依据就不生成摘要（一切以事实为依据） */
const MIN_CONTENT_CHARS = 80;

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

export function parseModelJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function runModel(userContent: string): Promise<string | null> {
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

/** 把模型输出规整成统一的 event_key / entities（跨源聚类唯一依据） */
export function normalizeEventMeta(parsed: Record<string, unknown> | null): {
  eventKey: string | null;
  entities: string[] | null;
} {
  if (!parsed) return { eventKey: null, entities: null };
  const rawKey = typeof parsed.event_key === "string" ? parsed.event_key : "";
  const normKey = rawKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const eventKey = normKey.length > 0 ? normKey : null;
  const rawEnt = Array.isArray(parsed.entities) ? parsed.entities : [];
  const entities = rawEnt
    .map((e) => (typeof e === "string" ? e.trim() : ""))
    .filter((e) => e.length > 0)
    .slice(0, 5);
  return { eventKey, entities: entities.length > 0 ? entities : null };
}

function computeResult(
  row: SummarizableRow,
  parsed: Record<string, unknown> | null,
  fallbackSummary: string | null,
): SummarizeResultV3 {
  if (!parsed) {
    // 兼容降级：模型未返回结构化 JSON 时，只保留纯摘要文本，不打分
    return {
      summary: fallbackSummary,
      keyPoints: null,
      industryImpact: null,
      relevance: null,
      quality: null,
      impact: null,
      final: null,
      eventKey: null,
      entities: null,
    };
  }
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() || null : null;
  const rawPoints = Array.isArray(parsed.key_points) ? parsed.key_points : [];
  const keyPoints = rawPoints
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .slice(0, 3);
  const industryImpact =
    typeof parsed.industry_impact === "string" ? parsed.industry_impact.trim() || null : null;
  const relevance = clampScore(parsed.relevance);
  const quality = clampScore(parsed.quality);
  let impact = clampScore(parsed.impact);
  if (impact != null && PROMO_TITLE_RE.test(row.title)) impact = Math.min(impact, 30);

  const { eventKey, entities: cleanEntities } = normalizeEventMeta(parsed);

  let final: number | null = null;
  if (relevance != null && quality != null && impact != null) {
    const authority = Math.max(0, Math.min(100, row.authority || 60));
    final = Math.round(0.2 * relevance + 0.2 * authority + 0.25 * quality + 0.35 * impact);
  }
  return {
    summary: summary ?? fallbackSummary,
    keyPoints: keyPoints.length > 0 ? keyPoints : null,
    industryImpact,
    relevance,
    quality,
    impact,
    final,
    eventKey,
    entities: cleanEntities,
  };
}

// 回填专用：只让模型判断 event_key + entities（复用同一段正文，但提示更轻，不重复生成摘要/评分）。
// 返回 null 表示模型调用失败（调用方应按"无事件"处理并继续）。
const EVENT_META_PROMPT = `你是 AI 新闻聚类助手。判断一条新闻是否对应一个具体、可独立描述的事件，仅输出 JSON（不要输出其他内容）：
{"event_key":"规范化英文事件slug(小写、连字符、≤5词、只含a-z0-9-；若没有单一事件则留空字符串\"\")","entities":["实体1","实体2"]}
同一事件的不同媒体、不同语言报道必须输出完全相同的 event_key（这是跨源聚类唯一依据）。只依据给定事实，不得编造。`;

export async function extractEventMeta(
  row: SummarizableRow,
): Promise<{ eventKey: string | null; entities: string[] | null } | null> {
  if (!row.content || row.content.length < MIN_CONTENT_CHARS) {
    return { eventKey: null, entities: null };
  }
  const parts = [`标题：${row.titleZh ?? row.title}`];
  if (row.titleZh && row.titleZh !== row.title) parts.push(`原标题：${row.title}`);
  parts.push(`来源：${row.sourceName}`);
  parts.push(`正文摘录：${row.content}`);
  try {
    const raw = await runModel(`${EVENT_META_PROMPT}\n\n${parts.join("\n")}`);
    const parsed = raw ? parseModelJson(raw) : null;
    return normalizeEventMeta(parsed);
  } catch {
    return null;
  }
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
        keyPoints: null,
        industryImpact: null,
        relevance: null,
        quality: null,
        impact: null,
        final: null,
        eventKey: null,
        entities: null,
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

      // 兼容降级：非 JSON 输出按纯文本摘要处理（旧版行为）；
      // 但形似 JSON 的残缺输出（截断/格式损坏）不许当摘要——整串 JSON 显示给用户就是事故，留待下轮重试
      const looksLikeJson = raw!.trimStart().startsWith("{");
      const fallback = !parsed && !looksLikeJson ? raw! : null;
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
