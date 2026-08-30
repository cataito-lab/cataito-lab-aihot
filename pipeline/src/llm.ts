import { httpFetch } from "./net";

/**
 * 统一 LLM 调用层（OpenAI 兼容协议）。
 *
 * 默认主力：Gemini 2.5 Flash（Google AI Studio 免费层：10 RPM / 250 RPD / 1M 上下文，质量顶尖）。
 * 自动兜底：智谱 GLM-4-Flash（永久免费、无 Token 上限、30 并发、中文最强）。
 *
 * 任一 provider 限流(429) 时自动切换到另一个；全部 429 时抛出含 "429" 的错误，
 * 供 backfill-insight 的「连续 429 提前退出」逻辑使用（避免空跑烧额度）。
 *
 * 环境变量：
 *   LLM_PROVIDER     可选 "gemini"(默认) | "zhipu" | "workersai"(legacy Cloudflare)
 *   GEMINI_API_KEY   主力 provider 密钥
 *   ZHIPU_API_KEY    兜底 provider 密钥
 *   CF_ACCOUNT_ID / CF_AI_API_TOKEN  仅 LLM_PROVIDER=workersai 时使用
 */

type ProviderName = "gemini" | "zhipu";

interface Provider {
  name: ProviderName;
  baseURL: string;
  model: string;
  apiKey: string;
}

function buildProviderOrder(): Provider[] {
  const forced = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  const prefer: ProviderName[] =
    forced === "zhipu" ? ["zhipu", "gemini"] : ["gemini", "zhipu"];

  const out: Provider[] = [];
  for (const name of prefer) {
    const apiKey = name === "gemini" ? process.env.GEMINI_API_KEY : process.env.ZHIPU_API_KEY;
    if (!apiKey) continue; // 只保留已配置密钥的 provider
    out.push({
      name,
      apiKey,
      baseURL:
        name === "gemini"
          ? "https://generativelanguage.googleapis.com/v1beta/openai"
          : "https://open.bigmodel.cn/api/paas/v4",
      model: name === "gemini" ? "gemini-2.5-flash" : "glm-4-flash",
    });
  }
  return out;
}

export interface LlmOptions {
  maxTokens?: number;
  json?: boolean;
}

/**
 * 调用聊天补全，自动跨 provider 容灾。
 * - 返回模型文本（已 trim）。
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
      "llm: 未配置任何 provider（需设置 GEMINI_API_KEY 或 ZHIPU_API_KEY；或将 LLM_PROVIDER=workersai 并配 CF_* 凭据）",
    );
  }

  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: opts.maxTokens ?? 1600,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  let lastErr: Error | null = null;
  let allRateLimited = true;

  for (const p of providers) {
    try {
      const res = await httpFetch(`${p.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${p.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...body, model: p.model }),
        signal: AbortSignal.timeout(45000),
      });

      if (res.status === 429) {
        console.warn(`  [llm] ${p.name} 429 限流，切换下一个 provider`);
        lastErr = new Error(`429 from ${p.name}`);
        continue;
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
        continue;
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!text) {
        allRateLimited = false;
        lastErr = new Error(`empty response from ${p.name}`);
        continue;
      }
      return text;
    } catch (err) {
      allRateLimited = false;
      lastErr = err instanceof Error ? err : new Error(String(err));
      // 网络层异常（ETIMEDOUT / ECONNRESET / fetch failed 等）也会走这里，
      // 之前完全静默导致排查困难；现在打印前 300 字，便于区分是网络问题还是别的问题。
      console.warn(`  [llm] ${p.name} error: ${lastErr.message.slice(0, 300)}`);
    }
  }

  throw new Error(`llm: 所有 provider 均失败${allRateLimited ? " (429 限流)" : ""}`);
}

const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";

/** legacy：直连 Cloudflare Workers AI（仅 LLM_PROVIDER=workersai 时由调用方使用） */
export async function runWorkersAi(system: string, user: string, maxTokens = 1600): Promise<string> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_AI_API_TOKEN;
  const model = process.env.CF_AI_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fp8";
  if (!accountId || !token) throw new Error("workers-ai skipped (no creds)");
  const res = await httpFetch(`${CF_API_BASE}/${accountId}/ai/run/${model}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(45000),
  });
  if (res.status === 429) throw new Error("429 from workers-ai");
  if (!res.ok) throw new Error(`workers-ai HTTP ${res.status}`);
  const data = (await res.json()) as { result?: { response?: unknown } };
  const out = data.result?.response;
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
  if (!text) throw new Error("workers-ai empty response");
  return text;
}
