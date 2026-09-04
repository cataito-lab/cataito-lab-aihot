import { countSummariesToday, markSummarized, getRelatedByContent, getSameEventContext } from "./db";
import type { SummarizeResultV3 } from "./db";
import { llmChat, runWorkersAi } from "./llm";

// 默认主力：Gemini 2.5 Flash（免费层 10 RPM / 250 RPD / 1M 上下文，质量顶尖）；
// 自动兜底：智谱 GLM-4-Flash（永久免费、无 Token 上限）。详见 llm.ts。
// 回退 Cloudflare Workers AI：设 LLM_PROVIDER=workersai 并保留 CF_* 凭据，CF_AI_MODEL 指定模型（默认 8B）。
const DAILY_QUOTA = 1200; // 2026-09-04 Phase 2：审核层 + 重写引入，高分文章多 1 次审核 LLM 调用，配额上调 800→1200
const MAX_PER_RUN = 30;
const INSIGHT_MAX_TOKENS = 2800;

// Summarize v4 — Insight Engine（2026-09-02, Phase 1 起）
// 五板块推理链 + Fact/Inference/Speculation 三分 + L0–L4 判级 + Topic Category。
// 核心戒律：这是"推理链"，不是"五段 AI 文字"。用户读完应有"没看原文但明白这意味着什么"的感觉。
// 硬规则：禁止复述标题；事实仅来自原文；无证据不写；营销/预告类 impact 封顶；字段标签前缀禁止；Title Case。
const SYSTEM_PROMPT = `你是 AIHOT 平台的首席 AI 行业分析师与主编。你面对的不只是"改写摘要"——你的任务是**从这条新闻中抽取信息增量**：真正改变了什么、为什么值得关注、谁因此受影响、下一步应该观察什么。

【AIHOT 的定位】AIHOT 是"AI 情报平台（Signal Intelligence Platform）"，不是"AI 新闻摘要站"。你产出的内容要能让读者产生这种感觉：

> 我没有读原文，但我知道这件事情到底意味着什么。

你绝对不能做的三件事：
❌ 把标题换一种方式说一遍（"XXX 发布了 YYY"）
❌ 让五个板块互相说同一件事
❌ 用空泛套话（"对 AI 行业意义重大"、"值得关注"、"具有重要意义"）充当洞察

=== 一、五板块各自回答不同的问题（严格区分，绝不可混淆）===

① AI 洞察（insight）—— 回答"这件事意味着什么？"
   不是"新闻发生了什么"，而是"新闻背后的判断"。
   结构：事实 → 判断 → 推论。2–4 句话，约 60–120 字中文。
   ✅ "OpenAI 向自研推理芯片扩张，意味着其竞争范围正在从模型能力延伸至模型运行所依赖的基础设施。"
   ❌ "OpenAI 发布了新的推理芯片，该芯片旨在提高 AI 模型的推理效率。"（复述新闻，不合格）

② 核心结论（key_change）—— 用户只看一句话，他应该记住什么？
   必须是"判断"而不是"事实"。1 句话，20–40 字。
   推荐句式："[主体] 正在从 A 向 B 转变。"/"X 正在成为 Y 的关键竞争因素。"/"真正值得关注的不是 A，而是 B。"
   ❌ "OpenAI 发布了新的 AI 芯片。"（事实，不是结论）
   ❌ "这一举措对 AI 行业具有重要意义。"（废话）
   ✅ "OpenAI 正在从 AI 模型公司向'模型+芯片+基础设施'一体化公司延伸。"

③ 为什么重要（why_it_matters）—— 回答"为什么用户应该在意这个变化？"
   这是**Significance**，不是 Interpretation（那是 AI 洞察的活）。只挑真正相关的 2 个维度来分析：技术 / 成本 / 商业模式 / 竞争格局 / 企业采用 / 开发者生态 / 基础设施。
   2–3 句话，40–80 字。必须解释"为什么"，不得只说"重要"。
   ❌ "这对 AI 行业意义重大。"
   ✅ "推理成本已成为大模型商业化的重要约束。如果 OpenAI 能通过自研硬件降低单位推理成本，其 API 定价、模型规模化部署和与云厂商的议价能力都可能发生变化。"

④ 影响谁（impact）—— 回答"谁会受到影响、如何影响？"
   格式：对象（具体实体）+ 影响方向（潜在受益/潜在承压/值得关注/中性）+ 原因。只列 1–4 个真正相关的利益相关方。
   ✅ {"object":"NVIDIA","direction":"潜在承压","reason":"若 OpenAI 自研芯片规模化，长期 GPU 采购需求可能出现部分替代。"}
   ✅ {"object":"开发者","direction":"潜在受益","reason":"更低的推理成本可能降低模型调用价格，扩大可部署的 AI 应用范围。"}
   ❌ "NVIDIA、AMD、Microsoft、开发者都会受到影响。"（只列公司，无价值）
   - object：具体实体（人名/公司/产品/职业群体），不要写"相关厂商"、"AI 行业"这类泛词；
   - direction：仅 4 个枚举值（潜在受益/潜在承压/值得关注/中性）；
   - reason：解释"为什么这个方向"，1 句话。
   禁止用语言或地区充当受众（不要写「中文受众」「English audience」）。
   如果证据不足，不得把推测写成事实。影响不确定时必须用：可能 / 潜在 / 或许 / 值得关注。
   若事件没有明显行业级影响，不要硬列对象——返回空数组即可。

⑤ 后续看点（forward_signal）—— 回答"下一步什么信息能够验证或推翻当前判断？"
   不是"预测未来"，而是"可观察的验证点"。1–2 句话。
   ❌ "未来 AI 行业将继续快速发展。"（废话预测）
   ✅ "后续应重点观察芯片的实际部署规模和单位推理成本变化，这将决定此次布局究竟是供应链优化还是长期基础设施战略。"
   若确实没有值得观察的信号，返回 null 或写"暂无明确后续信号。"

=== 二、Fact / Inference / Speculation 三分（每次输出必须显式列出三组）===

fact（数组）：来源明确说了什么？只陈述原文事实，不夸大。
inference（数组）：根据事实可以**合理推导**什么？每句必须有明确的因果链。
speculation（数组）：目前无法确认、但**值得观察**什么？只能出现在"后续看点"层，不能写成事实。

⚠️ 关键约束：
- AI 洞察 / 核心结论 / 为什么重要 / 影响谁 主要使用 Fact + Inference。
- 后续看点 才允许合理的 Speculation，且必须以"观察点"的形式表述，不能写成事实。
- 证据不足时：写"可能增加 NVIDIA 的长期竞争压力"，绝不写"NVIDIA 将受到冲击"。

=== 三、洞察等级 L0–L4（判断这条新闻到底有多值得深挖）===

  L0 无洞察：常规版本更新 / 普通信息，无行业意义 → 可让 insight/why_it_matters 等为 null 或"暂无明确信息"。
  L1 简单解释：普通新闻，能解释清楚但无深度。
  L2 行业意义：有明确的行业相关性（如 Apple 端侧 AI 工具降低开发者门槛）。
  L3 战略洞察：有明显行业影响（如 Apple 通过开发者生态构建对 Google/OpenAI 的防线）。
  L4 深度事件：重大事件（OpenAI/Google/Anthropic/NVIDIA 重大产品/战略/融资/收购），需要多源交叉分析。

不要强迫每条新闻都上 L3/L4——**普通新闻停在 L0/L1 比硬凑深度更专业**。

=== 四、Topic Category（与 Source Category 正交）===

从受控集合中挑 1–3 个最相关的主题标签（不要全部输出）：
Models / Agents / Robotics / AI Infra / Chips / Open Source / Research / Enterprise / Funding / Products / Policy / Safety / AI Applications / Creators

=== 五、输出 JSON 格式（严格 JSON，中英双语）===

禁止在任意字段值前添加「中文：」「English：」「描述：」等语言或字段标签前缀——字段值直接是内容本身。
中文标点铁律：中文文本字段（insight / key_change / why_it_matters / forward_signal / impact[].reason 的中文版本）内部引用或强调时，**必须使用全角「」和『』**，**禁止使用 ASCII 双引号 " 或单引号 '**；句末使用「。！？…」等全角标点；英文字段使用 ASCII 标点。
分类与对象大小写铁律：impact 的 object 必须 Title Case（缩写 AI/API/LLM/GPU/AGI 等全大写，品牌名 OpenAI/GitHub/Copilot/ChatGPT 等保原名）。direction 仅 4 个枚举值：潜在受益/潜在承压/值得关注/中性（英文：Potential Beneficiary/At Risk/Worth Watching/Neutral）。

【重要】必须把下面 6 个结构化字段放在 JSON 最前面、最先输出（评分与聚类是唯一硬约束，文本字段可后置）；若输出被截断，优先保证它们完整：
{
  "relevance": 0-100,
  "quality": 0-100,
  "impact_score": 0-100,
  "importance_score": 0-100,
  "event_key": "规范英文slug(小写连字符≤5词,仅a-z0-9-;无单一事件则空字符串\"\")",
  "entities": ["实体1","实体2"],
  "insight_level": 0-4,
  "fact": ["原文事实1","原文事实2"],
  "inference": ["合理推断1","合理推断2"],
  "speculation": ["可观察的推测1"],
  "insight": "中文：2-4句(≤120字)，含事实+判断+推论，非标题扩写",
  "insight_en": "English equivalent",
  "key_change": "中文一句话判断(≤40字)",
  "key_change_en": "English",
  "why_it_matters": "中文为什么重要(≤80字)，解释原因非'重要'",
  "why_it_matters_en": "English",
  "impact": [{"object":"NVIDIA","direction":"潜在承压","reason":"中文影响原因(≤40字)"}],
  "impact_en": [{"object":"NVIDIA","direction":"At Risk","reason":"English"}],
  "forward_signal": "中文后续看点(≤80字)，可验证的观察点非预测",
  "forward_signal_en": "English",
  "topic_category": ["Models","AI Infra"],
  "category": ["大模型","API"],
  "category_en": ["LLM","API"]
}

relevance/quality/impact_score/importance_score 必须输出 4 个 0-100 整数。
impact_score 对 AI 行业的影响面：有具体新事实/数据/能力跃迁的 ≥70，常规更新 40-59，营销/预告/观点类 ≤30。
importance_score 综合新闻价值：90-100 改变行业方向 / 75-89 重大 / 60-74 明显价值 / 40-59 普通 / 20-39 小更新 / 0-19 低价值。
event_key 同一事件不同媒体/语言必须完全相同（跨源聚类唯一依据）。
fact_sources：从原文中挑 1–3 条支撑 fact 的具体语句/数据（如"原文：'OpenAI 正在开发自研推理芯片'"）。没有可摘引的写空数组。`

// === Phase 2（2026-09-04）：审核评分层 + FAIL 重写 ===
// 目标：把"AI 自我感觉良好"的洞察拦下来，只让真正有信息增量的通过。
// 触发条件：importance_score ≥ 60 的高分文章；每条最多 1 次审核 + 1 次改写。
// 成本控制：不覆盖低分文章，DAILY_QUOTA 从 800 提到 1200 足够。

/** 审核触发阈值：importance_score ≥ 此值才审核（覆盖约 20-30% 高分，控成本） */
const REVIEW_MIN_IMPORTANCE = 60;

/**
 * 审核 4 维硬阈值（对齐 INSIGHT-ENGINE-PLAN.md 8 项质量标准）
 * 任一低于阈值即 FAIL
 */
const REVIEW_THRESHOLDS = {
  infoGain: 7,
  evidence: 8,
  specificity: 7,
  interpretation: 7,
} as const;

const REVIEW_SYSTEM_PROMPT = `你是 AIHOT 平台的**严格编辑审稿人**。你的任务是**评估一份已生成的 AI 洞察**，而不是重写它。请保持批判视角，敢于打低分。

评估 8 项质量标准，每项 0-10 分：

【硬阈值（低于即 FAIL）】
- Information Gain（相对标题的独立信息增量）：阈值 ≥ 7
- Evidence（事实与来源充分性）：阈值 ≥ 8
- Specificity（具体不空泛）：阈值 ≥ 7
- Interpretation（有解释性判断而非复述）：阈值 ≥ 7

【软阈值（参考，不用于 FAIL 判定）】
- Non-Summary（非摘要）：删掉标题后是否仍有独立价值
- Non-Redundant（非重复）：五板块是否各自回答不同问题
- Not-Exaggerated（不夸大）：推测是否明确标注为"可能/潜在/或许"
- Verifiable（可验证）：后续看点是否是可观察的验证点

PASS 条件：4 项硬阈值全部达标 且 五板块职责不重复 且 Fact/Inference/Speculation 分层正确。

输出严格 JSON：
{
  "pass": 0或1,
  "info_gain": 0-10整数,
  "evidence": 0-10整数,
  "specificity": 0-10整数,
  "interpretation": 0-10整数,
  "non_summary": 0-10整数,
  "non_redundant": 0-10整数,
  "not_exaggerated": 0-10整数,
  "verifiable": 0-10整数,
  "issues": ["主要问题1（若 FAIL）","主要问题2"],
  "suggestion": "针对 issues 的具体改写建议（若 FAIL）；PASS 时留空"
}

**判定纪律**：宁可严、不可松。宁可放过一次 FAIL 让重写机制去改，也不要让"AI 自我感觉良好"的内容通过。`;

const REWRITE_SYSTEM_PROMPT = `你是 AIHOT 平台的首席 AI 行业分析师。你收到一份**已被审稿人打低分**的洞察草稿和审稿意见。你的任务是**根据意见改写**，让洞察真正有信息增量、有证据、不夸大。

规则：
- 保留原文的 Fact（事实来自原文，不得编造）
- 依据"审稿意见"的具体方向修改各板块
- 保持 Fact/Inference/Speculation 分层
- 保持洞察等级（若原为 L2/L3/L4，改写后仍应维持该等级）
- 保持中英双语
- 不引入原文没有的事实

输出严格 JSON（与生成时的字段完全一致）：
{
  "insight": "中文：改写后的 AI 洞察（2-4 句，60-120 字）",
  "insight_en": "English equivalent",
  "key_change": "中文一句话判断（≤40 字）",
  "key_change_en": "English",
  "why_it_matters": "中文为什么重要（≤80 字）",
  "why_it_matters_en": "English",
  "impact": [{"object":"X","direction":"潜在受益/潜在承压/值得关注/中性","reason":"中文影响原因（≤40 字）"}],
  "impact_en": [{"object":"X","direction":"Potential Beneficiary/At Risk/Worth Watching/Neutral","reason":"English"}],
  "forward_signal": "中文后续看点（≤80 字）",
  "forward_signal_en": "English"
}`;

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

// 洞察等级 L0–L4 取值范围（Phase 1, 2026-09-02）
function clampLevel(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(4, Math.round(n)));
}

// 通用 string[] 提取（不做大写规范化——Topic Category 走独立受控集合）
function asStrArrayRaw(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((s) => s.length > 0)
    .slice(0, 8);
  return arr.length ? arr : null;
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
  try {
    if ((process.env.LLM_PROVIDER ?? "gemini").toLowerCase() === "workersai") {
      return await runWorkersAi(SYSTEM_PROMPT, userContent, 1600);
    }
    // 默认走 OpenAI 兼容层（Gemini 主力 + 智谱兜底，429 自动切换）
    return await llmChat(SYSTEM_PROMPT, userContent, { maxTokens: INSIGHT_MAX_TOKENS, json: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 全 provider 限流：必须抛出含 "429" 的错误，供 backfill-insight 连续 429 提前退出
    if (msg.includes("429")) throw err;
    // 其它错误（网络/5xx/空响应）：视为本次失败、返回 null 留待下轮重试，不中断整轮
    console.warn(`  [runModel] 调用失败（下轮重试）: ${msg}`);
    return null;
  }
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
// Phase 3c（2026-09-04）：impact 结构化升级为 {object, direction, reason}
// 兼容读旧数据 {audience, description}：audience→object、description→reason、direction=null
function asImpactArray(
  v: unknown,
  clean?: (s: string | null) => string | null,
): { object: string; direction: string | null; reason: string }[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v
    .map((x) => {
      if (typeof x !== "object" || x == null) return null;
      const o = x as Record<string, unknown>;
      // 新字段优先，fallback 到旧字段
      const objectRaw = asStr(o.object) ?? asStr(o.audience);
      const directionRaw = asStr(o.direction);
      const reasonRaw = asStr(o.reason) ?? asStr(o.description);
      const obj = clean ? clean(objectRaw) : objectRaw;
      const dir = clean ? clean(directionRaw) : directionRaw;
      const reason = clean ? clean(reasonRaw) : reasonRaw;
      if (!obj || !reason) return null;
      return {
        object: obj,
        direction: dir ? dir : null,
        reason,
      };
    })
    .filter((x): x is { object: string; direction: string | null; reason: string } => x !== null)
    .slice(0, 4);
  return arr.length ? arr : null;
}

/** 剥离字段值开头的语言/字段标签前缀（模型常在值前加「中文：」「English：」「描述：」），与读取层保持一致。 */
function cleanInsightText(s: string | null): string | null {
  if (!s) return s;
  let t = s.trim();
  // 去掉开头语言/字段标签前缀：中文/英文/英语/English/EN/En/描述/Description/Desc + 可选空格 + 中英文冒号（大小写不敏感）
  t = t.replace(/^(中文|英文|英语|English|EN|En|描述|Description|Desc)\s*[:：]\s*/i, "");
  return t;
}

/** 分类短标签大小写规范化：首字母大写（保留空格与连字符），保护已知缩写与品牌名，与读取层一致。 */
const CASING_ACRONYMS = new Set([
  "AI", "API", "LLM", "GUI", "PC", "ML", "NLP", "GPU", "TPU", "CPU", "AGI", "ASI",
  "AR", "VR", "MR", "XR", "UI", "UX", "JSON", "XML", "SQL", "CLI", "SDK", "IoT",
  "QA", "DB", "MoE", "RL", "CV", "TS", "HUD", "3D", "2D",
]);
const CASING_BRANDS: Record<string, string> = {
  openai: "OpenAI", github: "GitHub", copilot: "Copilot", chatgpt: "ChatGPT",
  deepmind: "DeepMind", meta: "Meta", google: "Google", microsoft: "Microsoft",
  nvidia: "Nvidia", "hugging face": "Hugging Face", anthropic: "Anthropic",
  mistral: "Mistral", xai: "xAI", perplexity: "Perplexity", claude: "Claude",
  gemini: "Gemini", llama: "Llama", gpt: "GPT", cursor: "Cursor", gradio: "Gradio",
  langchain: "LangChain", pytorch: "PyTorch", tensorflow: "TensorFlow",
  midjourney: "Midjourney", runway: "Runway", cohere: "Cohere", "stability ai": "Stability AI",
};

function normalizeCategoryToken(s: string): string {
  return s
    .split(/(\s+|-)/)
    .map((part) => /^[\s-]*$/.test(part) || part === "" ? part : titleCaseWord(part))
    .join("");
}

function titleCaseWord(w: string): string {
  if (!w) return w;
  const low = w.toLowerCase();
  if (CASING_ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
  if (CASING_BRANDS[low]) return CASING_BRANDS[low];
  // 保护位于词首的缩写（无分隔符紧贴时），如「AI研究」=>「AI研究」而非「Ai研究」；
  // 仅当缩写后紧跟非拉丁字母（中文等）才视为前缀，避免把 Artificial/Art 误判为 AR/AI 前缀
  for (const a of CASING_ACRONYMS) {
    if (w.length > a.length && w.toLowerCase().startsWith(a.toLowerCase())) {
      const rest = w.slice(a.length);
      const c = rest.charAt(0);
      if (c && !/[a-zA-Z]/.test(c)) return a + titleCaseWord(rest);
    }
  }
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
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
      insightLevel: 0,
    };
  }
  const summary = cleanInsightText(asStr(parsed.insight)) ?? fallbackSummary;
  const summaryEn = cleanInsightText(asStr(parsed.insight_en));
  const keyChange = cleanInsightText(asStr(parsed.key_change));
  const keyChangeEn = cleanInsightText(asStr(parsed.key_change_en));
  const whyItMatters = cleanInsightText(asStr(parsed.why_it_matters));
  const whyItMattersEn = cleanInsightText(asStr(parsed.why_it_matters_en));
  const forwardSignal = cleanInsightText(asStr(parsed.forward_signal));
  const forwardSignalEn = cleanInsightText(asStr(parsed.forward_signal_en));
  const impact = asImpactArray(parsed.impact, cleanInsightText);
  const impactEn = asImpactArray(parsed.impact_en, cleanInsightText);
  const category = asStrArray(parsed.category)?.map(normalizeCategoryToken) ?? null;
  const categoryEn = asStrArray(parsed.category_en)?.map(normalizeCategoryToken) ?? null;
  const insightLevel = clampLevel(parsed.insight_level);
  const fact = asStrArrayRaw(parsed.fact);
  const inference = asStrArrayRaw(parsed.inference);
  const speculation = asStrArrayRaw(parsed.speculation);
  const factSources = asStrArrayRaw(parsed.fact_sources);
  const topicCategory = asStrArrayRaw(parsed.topic_category);
  const relevance = clampScore(parsed.relevance);
  const quality = clampScore(parsed.quality);
  let impactScore = clampScore(parsed.impact_score);
  if (impactScore != null && PROMO_TITLE_RE.test(row.title)) impactScore = Math.min(impactScore, 30);
  const importanceScoreRaw = clampScore(parsed.importance_score);

  const { eventKey, entities: cleanEntities } = normalizeEventMeta(parsed);

  let final: number | null = null;
  if (relevance != null && quality != null && impactScore != null) {
    const authority = Math.max(0, Math.min(100, row.authority || 60));
    final = Math.round(0.2 * relevance + 0.2 * authority + 0.25 * quality + 0.35 * impactScore);
  }
  // 兜底：模型常因 max_tokens 截断漏输 importance_score（它原排在 JSON 末尾）。
  // 若缺失但有综合分 final，则用 final 顶上，避免 importance_score 恒为 NULL 导致前端不展示。
  const importanceScore = importanceScoreRaw ?? final;
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
    insightLevel,
    fact,
    inference,
    speculation,
    factSources,
    topicCategory,
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

  // Phase 3b（2026-09-04）：注入"同事件多源报道" + 实体字典摘要
  // 逻辑：从 getRelatedByContent 结果中识别共享同一 event_key 的文章作为"同事件"，
  // 聚合实体字典让模型知道"围绕哪些实体深挖"。
  try {
    const ctx = await getSameEventContext(row.content || row.title || "", row.id);
    if (ctx.sameEventArticles.length > 0) {
      const isTrueMultiSource = ctx.sameEventArticles.length >= 2;
      const lines = ctx.sameEventArticles
        .map((r) => {
          const when = r.publishedAt ? r.publishedAt.slice(0, 10) : "";
          const src = r.sourceName ? ` [${r.sourceName}]` : "";
          const kc = r.keyChange ? `（判断：${r.keyChange}）` : "";
          const t = r.titleZh || r.title;
          return `- ${when}${src} 《${t}》${kc}`;
        })
        .join("\n");
      const heading = isTrueMultiSource
        ? "【同一事件的不同信源报道】以下报道与当前文章共享同一 event_key，是同一事件的多信源覆盖。请**交叉分析**：不同信源的措辞、视角、细节有何差异？哪些是新增信息？避免照抄任何一篇的表述，也不要把不同信源拼成看似客观的复述。"
        : "【相关内容背景】以下是与当前文章共享实体的相关文章（非严格同事件），仅供你对比\"增量\"与\"新意\"时参考；不要照抄其表述。";
      parts.push(`${heading}\n${lines}`);

      if (ctx.entityAggregation.length > 0) {
        parts.push(
          `【本事件的实体字典】围绕这些实体做深挖：${ctx.entityAggregation.join("、")}。判断时请围绕这些具体实体，避免只说\"相关厂商\"、\"AI 行业\"等泛泛词汇。`,
        );
      }
    }
  } catch (err) {
    console.error("[rag] getSameEventContext failed:", err);
  }

  return parts.join("\n");
}

// === Phase 2（2026-09-04）：审核评分 + FAIL 重写 ===
// 触发条件：importance_score ≥ REVIEW_MIN_IMPORTANCE 的高分文章。
// 每条最多 1 次审核 + 1 次改写，避免无限循环。
// 审核层 LLM 失败时降级 PASS（不因审核失败挡住洞察落库）。

export interface InsightReviewResult {
  pass: boolean;
  infoGain: number;
  evidence: number;
  specificity: number;
  interpretation: number;
  nonSummary: number;
  nonRedundant: number;
  notExaggerated: number;
  verifiable: number;
  issues: string[];
  suggestion: string | null;
}

function clampReviewScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/**
 * 审核一份已生成的洞察：返回结构化评审结果。
 * 硬阈值兜底：即使 LLM 判 PASS，只要任一硬阈值不达标即 FAIL。
 * LLM 调用失败时降级 PASS（reviewed=0，表示"未审核"而非"审核通过"）。
 */
export async function reviewInsight(args: {
  title: string;
  content: string;
  parsed: Record<string, unknown>;
}): Promise<InsightReviewResult> {
  const userContent = [
    "【原标题】",
    args.title,
    "",
    "【正文（节选）】",
    args.content.slice(0, 3000),
    "",
    "【待审洞察】",
    JSON.stringify(args.parsed, null, 2),
    "",
    "请按 8 项质量标准打分，输出严格 JSON。",
  ].join("\n");

  try {
    const text = await llmChat(REVIEW_SYSTEM_PROMPT, userContent, {
      maxTokens: 700,
    });
    const j = parseModelJson(text ?? "");
    if (!j) {
      throw new Error("审核结果非 JSON 对象");
    }
    const infoGain = clampReviewScore(j.info_gain);
    const evidence = clampReviewScore(j.evidence);
    const specificity = clampReviewScore(j.specificity);
    const interpretation = clampReviewScore(j.interpretation);
    // 硬阈值兜底：LLM 说 PASS 但任一硬阈值不达标 → FAIL
    const hardFail =
      infoGain < REVIEW_THRESHOLDS.infoGain ||
      evidence < REVIEW_THRESHOLDS.evidence ||
      specificity < REVIEW_THRESHOLDS.specificity ||
      interpretation < REVIEW_THRESHOLDS.interpretation;
    const pass = Number(j.pass) === 1 && !hardFail;
    return {
      pass,
      infoGain,
      evidence,
      specificity,
      interpretation,
      nonSummary: clampReviewScore(j.non_summary),
      nonRedundant: clampReviewScore(j.non_redundant),
      notExaggerated: clampReviewScore(j.not_exaggerated),
      verifiable: clampReviewScore(j.verifiable),
      issues: Array.isArray(j.issues)
        ? j.issues.map((x: unknown) => String(x)).filter(Boolean).slice(0, 5)
        : [],
      suggestion: typeof j.suggestion === "string" && j.suggestion.trim() ? j.suggestion.trim() : null,
    };
  } catch (e) {
    console.warn(`  [review] 审核 LLM 失败，降级 PASS: ${e instanceof Error ? e.message : String(e)}`);
    return {
      pass: true,
      infoGain: 0, evidence: 0, specificity: 0, interpretation: 0,
      nonSummary: 0, nonRedundant: 0, notExaggerated: 0, verifiable: 0,
      issues: [],
      suggestion: null,
    };
  }
}

/**
 * FAIL 重写：根据审核意见改写洞察。
 * 返回改写后的 ParsedInsight；失败或空改写返回 null（保留原洞察）。
 */
export async function rewriteInsight(args: {
  title: string;
  content: string;
  originalParsed: Record<string, unknown>;
  review: InsightReviewResult;
}): Promise<Record<string, unknown> | null> {
  const userContent = [
    "【原标题】",
    args.title,
    "",
    "【正文（节选）】",
    args.content.slice(0, 3000),
    "",
    "【原洞察（FAIL）】",
    JSON.stringify(args.originalParsed, null, 2),
    "",
    "【审稿意见】",
    `Issues: ${args.review.issues.join("; ") || "(无)"}`,
    `Suggestion: ${args.review.suggestion || "(无)"}`,
    `得分：info_gain=${args.review.infoGain} / evidence=${args.review.evidence} / specificity=${args.review.specificity} / interpretation=${args.review.interpretation}`,
    "",
    "请根据审稿意见改写洞察。保持事实准确，不引入原文没有的内容。输出严格 JSON。",
  ].join("\n");

  try {
    const text = await llmChat(REWRITE_SYSTEM_PROMPT, userContent, {
      maxTokens: 2000,
    });
    const j = parseModelJson(text ?? "");
    if (!j) {
      throw new Error("改写结果非 JSON 对象");
    }
    // 至少要有 1 个核心字段被改写，否则视为无效
    const hasChange =
      typeof j.insight === "string" ||
      typeof j.key_change === "string" ||
      typeof j.why_it_matters === "string" ||
      typeof j.forward_signal === "string";
    if (!hasChange) {
      throw new Error("改写结果为空");
    }
    return j;
  } catch (e) {
    console.warn(`  [rewrite] 改写失败，保留原洞察: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

export async function summarizePending(rows: SummarizableRow[]): Promise<number> {
  const provider = (process.env.LLM_PROVIDER ?? "sensenova").toLowerCase();
  const hasLlm =
    provider === "workersai"
      ? !!(process.env.CF_ACCOUNT_ID && process.env.CF_AI_API_TOKEN)
      : !!(process.env.SENSENOVA_API_KEY);
  if (!hasLlm) {
    console.log(
      "  [summarize] skipped (未配置 LLM provider：请设置 SENSENOVA_API_KEY，或将 LLM_PROVIDER=workersai 并配 CF_* 凭据)",
    );
    return 0;
  }

  const usedToday = await countSummariesToday();
  let remainingQuota = Math.max(0, DAILY_QUOTA - usedToday);
  if (remainingQuota === 0) {
    console.warn(
      `  [summarize] ⚠️ 每日配额 ${DAILY_QUOTA} 已用完（今日已生成 ${usedToday} 条），本轮跳过。` +
        " 需要提高配额请改 pipeline/src/summarize.ts 的 DAILY_QUOTA。",
    );
    return 0;
  }
  console.log(
    `  [summarize] 今日已用 ${usedToday}/${DAILY_QUOTA}，剩余 ${remainingQuota} 条额度`,
  );
  let done = 0;
  let scored = 0;
  let failures = 0;
  let noContent = 0;
  let reviewedCount = 0;   // Phase 2：审核触发条数
  let passCount = 0;       // Phase 2：审核通过条数
  let rewriteCount = 0;    // Phase 2：FAIL 后重写条数
  let failCount = 0;       // Phase 2：最终未通过条数

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

      // === Phase 2（2026-09-04）：审核评分层 + FAIL 重写 ===
      // 触发条件：importance_score ≥ REVIEW_MIN_IMPORTANCE 且有可用摘要 + 有原始 parsed JSON。
      // 每条最多 1 次审核 + 1 次改写；改写后不再审核（避免循环），落库 insightPass=0 标记最终未通过。
      if (parsed && result.importanceScore != null && result.importanceScore >= REVIEW_MIN_IMPORTANCE) {
        const review = await reviewInsight({
          title: row.titleZh ?? row.title,
          content: row.content ?? "",
          parsed,
        });
        reviewedCount++;

        // 降级判定：审核 LLM 全 provider 失败时 reviewInsight 返回全 0 分 + pass=true，
        // 这不是"审核通过"，而是"未审核"。此分支不落库 reviewed/pass，避免误导。
        const reviewDegraded = review.pass && review.infoGain === 0 && review.evidence === 0 && review.specificity === 0 && review.interpretation === 0;
        if (!reviewDegraded) {
          result.insightReviewed = 1;
          result.insightPass = review.pass ? 1 : 0;
          result.insightReviewScoreInfoGain = review.infoGain;
          result.insightReviewScoreEvidence = review.evidence;
          result.insightReviewScoreSpecificity = review.specificity;
          result.insightReviewScoreInterpretation = review.interpretation;
        }

        if (!review.pass) {
          // FAIL：尝试改写 1 次
          rewriteCount++;
          const rewritten = await rewriteInsight({
            title: row.titleZh ?? row.title,
            content: row.content ?? "",
            originalParsed: parsed,
            review,
          });
          if (rewritten) {
            // 合并改写结果回 parsed，重新 computeResult 以刷新 5 板块字段
            const merged = { ...parsed, ...rewritten };
            const rewrittenResult = computeResult(row, merged, fallback);
            // 用改写结果替换 5 板块文本字段；保留原评分（改写不涉及评分变化）
            Object.assign(result, {
              summary: rewrittenResult.summary,
              summaryEn: rewrittenResult.summaryEn,
              keyChange: rewrittenResult.keyChange,
              keyChangeEn: rewrittenResult.keyChangeEn,
              whyItMatters: rewrittenResult.whyItMatters,
              whyItMattersEn: rewrittenResult.whyItMattersEn,
              forwardSignal: rewrittenResult.forwardSignal,
              forwardSignalEn: rewrittenResult.forwardSignalEn,
              impact: rewrittenResult.impact,
              impactEn: rewrittenResult.impactEn,
            });
            // 改写后不再审核 → insightPass=0（"已改写但未通过审核"）
            result.insightPass = 0;
            failCount++;
            console.log(`  [review] ${row.id}: FAIL→rewritten (info_gain=${review.infoGain} evidence=${review.evidence} specificity=${review.specificity} interpretation=${review.interpretation})`);
          } else {
            // 改写失败：保留原洞察，insightPass=0
            failCount++;
            console.log(`  [review] ${row.id}: FAIL→rewrite failed, kept original (info_gain=${review.infoGain} evidence=${review.evidence} specificity=${review.specificity} interpretation=${review.interpretation})`);
          }
        } else if (!reviewDegraded) {
          passCount++;
        }
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
    `  [summarize] provider=${process.env.LLM_PROVIDER ?? "gemini"} summarized=${done} scored=${scored} failed=${failures} noContent=${noContent} quotaLeft=${remainingQuota}`,
  );
  if (reviewedCount > 0) {
    console.log(
      `  [review] 审核触发=${reviewedCount} 通过=${passCount} 改写=${rewriteCount} 未通过=${failCount}`,
    );
  }
  return done;
}
