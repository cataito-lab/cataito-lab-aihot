import { countSummariesToday, markSummarized, getRelatedByContent } from "./db";
import type { SummarizeResultV3 } from "./db";
import { httpFetch } from "./net";

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";

const MODEL = process.env.CF_AI_MODEL ?? "@cf/meta/llama-3.1-70b-instruct";
const DAILY_QUOTA = 200;
const MAX_PER_RUN = 30;

// Summarize v3：一段式摘要（事实→核心变化→行业意义）+ 要点 + 行业影响 + 三维评分。
// 硬规则：禁止复述标题；只依据正文事实；原文没有的信息不得编造；营销/预告类 impact 封顶。
const SYSTEM_PROMPT = `你是专业的 AI 行业分析师。把一条 AI 新闻转化为有分析价值的 AI Insight（智能洞察），帮助用户理解：发生了什么、真正的变化、为什么值得关注、影响谁、接下来关注什么。

严禁只复述标题；若删去标题后洞察仍提供新信息才算合格。事实与推断分离：已确认事实来自原文，合理推断可用"这意味着/表明"，禁止无依据预测。
禁止空泛套话：不得出现"对AI安全/可靠性产生影响""具有重要意义""值得关注"等无信息量结论句；若某维度无具体事实，写"暂无明确信息"或省略。洞察必须指向本次事件相对既有认知的具体增量或差异（例如"过去风险集中在X，本次新增Y"）；缺乏可比过往案例时明说"暂无可比过往案例"，不得编造对比或引用不存在的过往事件。

分析方法（5 层）：
1. 事实：仅陈述新闻明确确认的信息，不夸大、不臆测。
2. 核心变化：必须是与既往的对比式陈述（"相比此前…"），解释"它改变了什么"，不接受静态描述。
3. 重要性：对产业/竞争格局/用户/成本/技术方向意味着什么；禁止空话（"重大突破"等）除非有证据。
4. 影响对象：开发者 / 企业用户 / 普通用户 / AI 创业者 / AI研究者，只列真正相关者，各写一句影响。
5. 未来信号：基于事实判断接下来值得观察什么；无法判断填"暂无明确后续信号。"。

按新闻类型（大模型/AI Agent/产品/API/开源模型/AI研究/芯片硬件/云计算/公司动态/融资/收购/合作/政策法规/AI安全/机器人/多模态/行业趋势）采用不同侧重。

严格输出 JSON（不要输出其他内容），中英双语：
{
  "insight": "中文：2-4句(≤120字)，含事实+核心变化+意义",
  "insight_en": "English equivalent",
  "key_change": "中文一句话最大变化(≤30字)",
  "key_change_en": "English",
  "why_it_matters": "中文为什么值得关注(≤60字)",
  "why_it_matters_en": "English",
  "impact": [{"audience":"中文受众","description":"中文影响(≤40字)"}],
  "impact_en": [{"audience":"English audience","description":"English"}],
  "forward_signal": "中文接下来关注什么(≤60字)",
  "forward_signal_en": "English",
  "category": ["大模型","API"],
  "category_en": ["LLM","API"],
  "relevance": 0-100,
  "quality": 0-100,
  "impact_score": 0-100,
  "importance_score": 0-100,
  "event_key": "规范英文slug(小写连字符≤5词,仅a-z0-9-;无单一事件则空字符串\"\")",
  "entities": ["实体1","实体2"]
}
必须输出 relevance/quality/impact_score/importance_score 四个 0-100 整数。impact_score 为对 AI 行业的影响面：有具体新事实/数据/能力跃迁的 ≥70，常规更新 40-59，营销/预告/观点类 ≤30；importance_score 为综合新闻价值（90-100改变行业方向,75-89重大,60-74明显价值,40-59普通,20-39小更新,0-19低价值）。event_key 同一事件不同媒体/语言必须完全相同（跨源聚类唯一依据）。`

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
      max_tokens: 1100,
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

function asStr(v: unknown): string | null {
  return typeof v === "string" ? v.trim() || null : null;
}
function asStrArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 5);
  return arr.length ? arr : null;
}
function asImpactArray(v: unknown): { audience: string; description: string }[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v
    .map((x) => {
      if (typeof x !== "object" || x == null) return null;
      const o = x as Record<string, unknown>;
      const audience = asStr(o.audience);
      const description = asStr(o.description);
      if (!audience || !description) return null;
      return { audience, description };
    })
    .filter((x): x is { audience: string; description: string } => x !== null)
    .slice(0, 4);
  return arr.length ? arr : null;
}

export function computeResult(
  row: SummarizableRow,
  parsed: Record<string, unknown> | null,
  fallbackSummary: string | null,
): SummarizeResultV3 {
  if (!parsed) {
    // 兼容降级：模型未返回结构化 JSON 时，只保留纯摘要文本，不打分
    return {
      summary: fallbackSummary,
      summaryEn: null,
      keyChange: null,
      keyChangeEn: null,
      whyItMatters: null,
      whyItMattersEn: null,
      forwardSignal: null,
      forwardSignalEn: null,
      impact: null,
      impactEn: null,
      category: null,
      categoryEn: null,
      relevance: null,
      quality: null,
      impactScore: null,
      importanceScore: null,
      final: null,
      eventKey: null,
      entities: null,
    };
  }
  const summary = asStr(parsed.insight) ?? fallbackSummary;
  const summaryEn = asStr(parsed.insight_en);
  const keyChange = asStr(parsed.key_change);
  const keyChangeEn = asStr(parsed.key_change_en);
  const whyItMatters = asStr(parsed.why_it_matters);
  const whyItMattersEn = asStr(parsed.why_it_matters_en);
  const forwardSignal = asStr(parsed.forward_signal);
  const forwardSignalEn = asStr(parsed.forward_signal_en);
  const impact = asImpactArray(parsed.impact);
  const impactEn = asImpactArray(parsed.impact_en);
  const category = asStrArray(parsed.category);
  const categoryEn = asStrArray(parsed.category_en);
  const relevance = clampScore(parsed.relevance);
  const quality = clampScore(parsed.quality);
  let impactScore = clampScore(parsed.impact_score);
  if (impactScore != null && PROMO_TITLE_RE.test(row.title)) impactScore = Math.min(impactScore, 30);
  const importanceScore = clampScore(parsed.importance_score);

  const { eventKey, entities: cleanEntities } = normalizeEventMeta(parsed);

  let final: number | null = null;
  if (relevance != null && quality != null && impactScore != null) {
    const authority = Math.max(0, Math.min(100, row.authority || 60));
    final = Math.round(0.2 * relevance + 0.2 * authority + 0.25 * quality + 0.35 * impactScore);
  }
  return {
    summary: summary ?? fallbackSummary,
    summaryEn,
    keyChange,
    keyChangeEn,
    whyItMatters,
    whyItMattersEn,
    forwardSignal,
    forwardSignalEn,
    impact: impact ? JSON.stringify(impact) : null,
    impactEn: impactEn ? JSON.stringify(impactEn) : null,
    category: category ? JSON.stringify(category) : null,
    categoryEn: categoryEn ? JSON.stringify(categoryEn) : null,
    relevance,
    quality,
    impactScore,
    importanceScore,
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

/**
 * 组装发送给模型的"用户内容"，并注入 C8 检索到的过往相关报道作为对比上下文。
 * 检索基于文章实体字典（已由模型抽取并存于 DB 的 entities 字段），纯词面匹配，
 * 不额外消耗模型调用。检索失败时仅跳过上下文注入，不影响主流程。
 */
export async function buildInsightUserContent(row: SummarizableRow): Promise<string> {
  const parts: string[] = [];
  parts.push(`标题：${row.titleZh ?? row.title}`);
  if (row.titleZh && row.titleZh !== row.title) parts.push(`原标题：${row.title}`);
  parts.push(`来源：${row.sourceName}`);
  parts.push(`正文摘录：${row.content}`);

  try {
    const related = await getRelatedByContent(row.content || row.title || "", row.id, 3);
    if (related.length > 0) {
      const lines = related
        .map((r) => {
          const when = r.publishedAt ? r.publishedAt.slice(0, 10) : "";
          const kc = r.keyChange ? `（进展：${r.keyChange}）` : "";
          const t = r.titleZh || r.title;
          return `- ${when} 《${t}》${kc}`;
        })
        .join("\n");
      parts.push(
        `【检索到的过往相关报道】以下是与本报道内容相关的历史文章，仅供你对比"增量"与"新意"时参考；不要照抄其表述，也不要重复生成相同结论：\n${lines}`,
      );
    }
  } catch (err) {
    console.error("[rag] getRelatedByContent failed:", err);
  }

  return parts.join("\n");
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
        summaryEn: null,
        keyChange: null,
        keyChangeEn: null,
        whyItMatters: null,
        whyItMattersEn: null,
        forwardSignal: null,
        forwardSignalEn: null,
        impact: null,
        impactEn: null,
        category: null,
        categoryEn: null,
        relevance: null,
        quality: null,
        impactScore: null,
        importanceScore: null,
        final: null,
        eventKey: null,
        entities: null,
      });
      noContent++;
      continue;
    }

    try {
      const userContent = await buildInsightUserContent(row);
      const raw = await runModel(userContent);
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
