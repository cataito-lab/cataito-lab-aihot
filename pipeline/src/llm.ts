import { httpFetch } from "./net";

/**
 * 统一 LLM 调用层（OpenAI 兼容协议）。
 *
 * 默认主力：Google Gemini Flash-Lite（AI Studio 免费 key，OpenAI 兼容端点）。
 * 自动兜底：商汤网关三模型（deepseek-v4-flash / sensenova / glm，共用 SENSENOVA_API_KEY）
 *          → Cloudflare Workers AI（10k neurons/天免费档）。
 *
 * 背景（2026-09-22）：商汤网关 key 曾整点封禁（三模型共用一个 key 一起 429），
 * 而 GitHub 工作流仍显示 success（假绿），洞察断流两天无人发现。
 * 因此容灾链必须跨厂商：Gemini（Google）与商汤网关互为独立单点。
 *
 * 任一 provider 限流(429) 时先按指数退避重试同一 provider（摊平 RPM 型突发），重试用尽再切换下一个；
 * 连续 LLM_429_BREAKER 次整体 429 失败后开启熔断——那已经是**当日额度耗尽**的特征
 * （免费档按太平洋零点重置，约 UTC 07:00 回血，几分钟内不会恢复），此后本进程内跳过退避秒级失败，
 * 避免整轮预算空转（2026-09-24 实测：无熔断时每轮 70min 里 240+ 次 429、洞察零产出）。
 * 全部 provider 失败时抛出错误，只要链路上出现过 429 就带 "429" 字样，
 * 供 backfill-insight 的「连续 429 提前退出」逻辑使用（避免空跑烧额度）。
 *
 * 注（2026-09-23）：商汤网关 key 已撤除，当前容灾链实际只剩 Gemini + Workers AI 两个
 * 低额度免费档，Gemini 为主、Workers AI 为兜底。
 *
 * 环境变量：
 *   LLM_PROVIDER        可选 "gemini"(默认) | "sensenova" | "deepseek" | "glm" | "workersai"
 *                       —— 指定首选，其余按默认顺序兜底
 *   GEMINI_API_KEY      Google AI Studio 免费 key（有则启用 gemini provider）
 *   GEMINI_MODEL        默认 gemini-3.5-flash-lite（2.5 系已对新用户下架，404）
 *   SENSENOVA_API_KEY   商汤网关 API key（token.sensenova.cn）
 *   SENSENOVA_BASE_URL  商汤网关 base_url（默认 https://token.sensenova.cn/v1）
 *   SENSENOVA_MODEL     商汤主力模型（默认 sensenova-6.8-flash-lite）
 *   CF_ACCOUNT_ID / CF_AI_API_TOKEN  Cloudflare Workers AI 凭据（有则启用 workersai 兜底）
 *   CF_AI_MODEL         workersai 模型。默认 @cf/meta/llama-3.1-70b-instruct——Actions 侧
 *                       此前没传该变量，链尾实际跑在代码旧默认值 8b-fp8 上，
 *                       而只有 70b 经本地实测能稳定吐出可解析的洞察 JSON
 *   LLM_TIMEOUT_MS      单跳请求超时（默认 120000；曾硬编码 45000 导致兜底跳全灭）
 *   LLM_429_RETRIES / LLM_429_BACKOFF_MS  429 就地退避次数与基础等待
 *   LLM_429_BREAKER     熔断阈值（默认 3 次连续全链路 429）
 */

type ProviderName = "gemini" | "sensenova" | "deepseek" | "glm" | "workersai";

interface Provider {
  name: ProviderName;
  baseURL: string;
  model: string;
  apiKey: string;
  /** Workers AI 的 OpenAI 兼容层不支持 response_format，需剥离 */
  noJsonMode?: boolean;
}

/** 商汤网关 base_url（token.sensenova.cn）—— 旗下所有模型共用同一端点 */
const SENSENOVA_BASE =
  process.env.SENSENOVA_BASE_URL || "https://token.sensenova.cn/v1";

/** Google Gemini 的 OpenAI 兼容端点 */
const GEMINI_BASE =
  process.env.GEMINI_BASE_URL ||
  "https://generativelanguage.googleapis.com/v1beta/openai";

function buildProviderOrder(): Provider[] {
  const forced = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();

  // 按优先级排列：forced provider 优先，其余按默认顺序兜底。
  // 默认顺序 = 跨厂商轮换：Google → 商汤网关(3 模型) → Cloudflare，
  // 任一厂商整体故障时下一跳仍在不同基础设施上。
  const DEFAULT_ORDER: ProviderName[] = ["gemini", "sensenova", "deepseek", "glm", "workersai"];
  const prefer: ProviderName[] =
    (DEFAULT_ORDER as string[]).includes(forced)
      ? [forced as ProviderName, ...DEFAULT_ORDER.filter((n) => n !== forced)]
      : DEFAULT_ORDER; // 未知 provider 回退默认

  const out: Provider[] = [];
  for (const name of prefer) {
    if (name === "gemini") {
      const key = process.env.GEMINI_API_KEY;
      if (!key) continue;
      out.push({
        name,
        apiKey: key,
        baseURL: GEMINI_BASE,
        model: process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
      });
      continue;
    }
    if (name === "workersai") {
      const accountId = process.env.CF_ACCOUNT_ID;
      const token = process.env.CF_AI_API_TOKEN;
      if (!accountId || !token) continue;
      out.push({
        name,
        apiKey: token,
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
        model: process.env.CF_AI_MODEL ?? "@cf/meta/llama-3.1-70b-instruct",
        noJsonMode: true,
      });
      continue;
    }
    // 商汤网关下的模型：sensenova / deepseek / glm 共用 SENSENOVA_API_KEY
    const sensenovaKey = process.env.SENSENOVA_API_KEY;
    if (!sensenovaKey) continue;
    const model =
      name === "sensenova"
        ? process.env.SENSENOVA_MODEL || "sensenova-6.8-flash-lite"
        : name === "deepseek"
          ? "deepseek-v4-flash"
          : "glm-5.2";
    out.push({ name, apiKey: sensenovaKey, baseURL: SENSENOVA_BASE, model });
  }
  return out;
}

export interface LlmOptions {
  maxTokens?: number;
  json?: boolean;
}

// 429 退避重试：免费档 provider 限的是"每分钟请求数(RPM)"时，摊平突发即可回血，
// 所以遇 429 不立刻放弃当前 provider，而是指数退避等一会儿再重试同一 provider。
// 非 429 错误（401/网络/空响应）无此必要，仍立刻切下一个 provider。
const LLM_429_RETRIES = Number(process.env.LLM_429_RETRIES ?? 2); // 每个 provider 额外重试次数
const LLM_429_BACKOFF_MS = Number(process.env.LLM_429_BACKOFF_MS ?? 10000);

// 单跳请求超时。2026-09-24 之前硬编码 45s：Workers AI 兜底跳在 Actions 里 21/21 次
// 精确卡在 45s 触发 `The operation was aborted due to timeout`，即该跳从未真正返回过，
// 宣称的两跳容灾实际只有一跳。本地实测同账户同端点产出一条洞察 JSON 需 19-25s
// （短正文）——45s 对长正文毫无余量。放宽到 120s 并可配。
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 120000);

// 限流熔断：连续 LLM_429_BREAKER 次「链路上至少有一个 provider 返回 429 且整体失败」，
// 判定为**当日额度已耗尽**（免费档按太平洋零点重置，不会在几分钟内回血）而非 RPM 抖动，
// 于是跳过退避与多跳重扫、秒级失败。
// 背景：2026-09-23 只加了退避重试、没加熔断，结果 09-24 全天每轮在 70min 预算里空转
// 240+ 次 429、洞察零产出，还把并发组后续 run 拖成 cancelled（满屏假失败）。
// 仍保留 3 次完整退避窗口，突发型 RPM 限流照旧在同一轮内自愈。
const LLM_429_BREAKER = Number(process.env.LLM_429_BREAKER ?? 3);
let rateLimitStreak = 0;
let breakerLogged = false;

/** 熔断是否已开启：调用方据此跳过本进程剩余 LLM 阶段，别再烧时间预算 */
export function llmQuotaBreakerOpen(): boolean {
  return rateLimitStreak >= LLM_429_BREAKER;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 第 attempt 次重试的退避时长：base * 2^attempt + 0~2s 抖动（避免多路同步重试再次撞窗） */
function backoffMs(attempt: number): number {
  return LLM_429_BACKOFF_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 2000);
}

/**
 * 调用聊天补全，自动跨 provider 容灾。
 * - 返回模型文本（已 trim）。
 * - 单 provider 遇 429 时按 backoffMs 退避重试 LLM_429_RETRIES 次，仍限流才切换下一个。
 * - 全部 provider 失败时抛出错误；若所有失败均为 429 限流，错误信息含 "429"。
 */
export async function llmChat(
  system: string,
  user: string,
  opts: LlmOptions = {},
): Promise<string> {
  const providers = buildProviderOrder();
  if (providers.length === 0) {
    throw new Error(
      "llm: 未配置任何 provider（需设置 GEMINI_API_KEY / SENSENOVA_API_KEY / CF_* 凭据之一）",
    );
  }

  const baseBody: Record<string, unknown> = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: opts.maxTokens ?? 1600,
  };

  let lastErr: Error | null = null;
  let saw429 = false;
  const breakerOpen = rateLimitStreak >= LLM_429_BREAKER;
  if (breakerOpen && !breakerLogged) {
    breakerLogged = true;
    console.warn(
      `  [llm] 熔断开启：连续 ${rateLimitStreak} 次全链路 429，判定当日免费额度已耗尽，` +
        `本轮剩余调用跳过退避直接失败（额度按太平洋零点重置，约 UTC 07:00 恢复）。`,
    );
  }

  for (const p of providers) {
    const maxAttempt = breakerOpen ? 0 : LLM_429_RETRIES;
    for (let attempt = 0; attempt <= maxAttempt; attempt++) {
      try {
        const body: Record<string, unknown> = { ...baseBody, model: p.model };
        if (opts.json && !p.noJsonMode) body.response_format = { type: "json_object" };
        const res = await httpFetch(`${p.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${p.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        });

        if (res.status === 429) {
          saw429 = true;
          lastErr = new Error(`429 from ${p.name}`);
          if (attempt < maxAttempt) {
            const wait = backoffMs(attempt);
            console.warn(
              `  [llm] ${p.name} 429 限流，${Math.round(wait / 1000)}s 后重试 (${attempt + 1}/${LLM_429_RETRIES})`,
            );
            await sleep(wait);
            continue; // 退避后重试同一 provider
          }
          console.warn(
            breakerOpen
              ? `  [llm] ${p.name} 429（熔断中，不退避）`
              : `  [llm] ${p.name} 429 限流，重试仍失败，切换下一个 provider`,
          );
          break; // 429 重试用尽（或熔断中）→ 下一个 provider
        }
        if (!res.ok) {
          const detail = await res.text().catch(() => "");
          // 打印具体 HTTP 状态和响应体前 300 字，避免被上层 catch 静默吞掉
          console.warn(
            `  [llm] ${p.name} HTTP ${res.status}: ${detail.slice(0, 300) || "<empty body>"}`,
          );
          lastErr = new Error(
            `HTTP ${res.status} from ${p.name}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
          );
          break; // 非 429：重试同一 provider 无意义，直接下一个
        }

        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const text = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (!text) {
          lastErr = new Error(`empty response from ${p.name}`);
          break;
        }
        rateLimitStreak = 0; // 任一跳成功即证明额度还在，复位熔断计数
        return text;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        // 网络层异常（ETIMEDOUT / ECONNRESET / fetch failed 等）也会走这里，
        // 之前完全静默导致排查困难；现在打印前 300 字，便于区分是网络问题还是别的问题。
        console.warn(`  [llm] ${p.name} error: ${lastErr.message.slice(0, 300)}`);
        break; // 网络异常不就地重试，交给下一个 provider
      }
    }
  }

  // 链路上出现过 429 就按"限流"上报（backfill 的连续 429 中止与上层的额度判定都依赖这个标记），
  // 即便最后一跳是超时——那通常也是同日额度耗尽的连带表现。
  if (saw429) rateLimitStreak++;
  else rateLimitStreak = 0;
  throw new Error(`llm: 所有 provider 均失败${saw429 ? " (429 限流)" : ""}`);
}
