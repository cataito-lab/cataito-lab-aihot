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
 * 任一 provider 限流(429) 时先按指数退避重试同一 provider（免费档限的是每分钟 RPM 而非当日
 * 额度，摊平突发即可回血），重试用尽再切换下一个；全部 429 时抛出含 "429" 的错误，
 * 供 backfill-insight 的「连续 429 提前退出」逻辑使用（避免空跑烧额度）。
 *
 * 注（2026-09-23）：商汤网关 key 已撤除，当前容灾链实际只剩 Gemini + Workers AI 两个
 * 独立低 RPM 免费档。退避重试正是为消除"两档同时被突发打限 → 全挂退出码 1"的脆弱点。
 *
 * 环境变量：
 *   LLM_PROVIDER        可选 "gemini"(默认) | "sensenova" | "deepseek" | "glm" | "workersai"
 *                       —— 指定首选，其余按默认顺序兜底
 *   GEMINI_API_KEY      Google AI Studio 免费 key（有则启用 gemini provider）
 *   GEMINI_MODEL        默认 gemini-3.5-flash-lite（2.5 系已对新用户下架，404）
 *   SENSENOVA_API_KEY   商汤网关 API key（token.sensenova.cn）
 *   SENSENOVA_BASE_URL  商汤网关 base_url（默认 https://token.sensenova.cn/v1）
 *   SENSENOVA_MODEL     商汤主力模型（默认 sensenova-6.8-flash-lite）
 *   CF_ACCOUNT_ID / CF_AI_API_TOKEN  Cloudflare 凭据（有则启用 workersai 兜底）
 *   CF_AI_MODEL         workersai 模型（默认 @cf/meta/llama-3.1-8b-instruct-fp8）
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
        model: process.env.CF_AI_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8",
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

// 429 退避重试：免费档 provider（Gemini / Workers AI）限的是"每分钟请求数(RPM)"，
// 而非当日总额度。批量摘要/翻译瞬间打满 RPM 时，日志会显示"当日额度还剩上千条却全 429"。
// 遇 429 不立刻放弃当前 provider，而是指数退避等一会儿再重试同一 provider，给 RPM 窗口回血，
// 摊平突发。非 429 错误（401/网络/空响应）无此必要，仍立刻切下一个 provider。
const LLM_429_RETRIES = Number(process.env.LLM_429_RETRIES ?? 2); // 每个 provider 额外重试次数
const LLM_429_BACKOFF_MS = Number(process.env.LLM_429_BACKOFF_MS ?? 10000);

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
  let allRateLimited = true;

  for (const p of providers) {
    for (let attempt = 0; attempt <= LLM_429_RETRIES; attempt++) {
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
          signal: AbortSignal.timeout(45000),
        });

        if (res.status === 429) {
          lastErr = new Error(`429 from ${p.name}`);
          if (attempt < LLM_429_RETRIES) {
            const wait = backoffMs(attempt);
            console.warn(
              `  [llm] ${p.name} 429 限流，${Math.round(wait / 1000)}s 后重试 (${attempt + 1}/${LLM_429_RETRIES})`,
            );
            await sleep(wait);
            continue; // 退避后重试同一 provider
          }
          console.warn(`  [llm] ${p.name} 429 限流，重试仍失败，切换下一个 provider`);
          break; // 429 重试用尽 → 下一个 provider
        }
        if (!res.ok) {
          allRateLimited = false;
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
          allRateLimited = false;
          lastErr = new Error(`empty response from ${p.name}`);
          break;
        }
        return text;
      } catch (err) {
        allRateLimited = false;
        lastErr = err instanceof Error ? err : new Error(String(err));
        // 网络层异常（ETIMEDOUT / ECONNRESET / fetch failed 等）也会走这里，
        // 之前完全静默导致排查困难；现在打印前 300 字，便于区分是网络问题还是别的问题。
        console.warn(`  [llm] ${p.name} error: ${lastErr.message.slice(0, 300)}`);
        break; // 网络异常不就地重试，交给下一个 provider
      }
    }
  }

  throw new Error(`llm: 所有 provider 均失败${allRateLimited ? " (429 限流)" : ""}`);
}
