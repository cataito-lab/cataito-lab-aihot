import { httpFetch } from "./net";
import { llmChat } from "./llm";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

const MAX_NEW_PER_RUN = 100;
const REQUEST_GAP_MS = 150;

const LANG_NAMES: Record<string, string> = {
  "zh-CN": "Simplified Chinese",
  "zh": "Simplified Chinese",
  en: "English",
  ja: "Japanese",
  es: "Spanish",
  fr: "French",
};

export interface TranslatableRow {
  id: string;
  title: string;
}

export interface TranslationOutcome {
  updates: { id: string; titleZh: string }[];
  failed: number;
  viaFallback: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 通道 1：Google gtx 免费端点，质量最好。对数据中心 IP 常限流，故只做单次尝试。 */
async function translateGtx(text: string, target: string): Promise<string> {
  const url =
    `${ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await httpFetch(url, {
    headers: { "User-Agent": "ai-news-pipeline/0.1" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("translate bad payload");
  const segments = (data[0] as unknown[])
    .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? "") : ""))
    .join("");
  return segments.trim();
}

/** 通道 2（兜底）：用统一 LLM 层（Gemini 主力 + 智谱兜底）做指令式翻译。
 *  仅在 gtx 免费端点被限流（数据中心 IP 常触发）时启用，质量接近 gtx。 */
async function translateViaLlm(text: string, target: string): Promise<string> {
  const langName = LANG_NAMES[target] ?? target;
  const out = await llmChat(
    `You are a professional news translator. Translate the user text into ${langName}. ` +
      "Keep product/company/person names in their original form. Output ONLY the translation, with no surrounding quotes or extra commentary.",
    text,
    { maxTokens: 400 },
  );
  return out.replace(/^["'「『]|["'」』]$/g, "").trim();
}

type ChannelName = "gtx" | "llm";

const CHANNELS: [ChannelName, (text: string, target: string) => Promise<string>][] = [
  ["gtx", translateGtx],
  ["llm", translateViaLlm],
];

async function smartWithMeta(
  text: string,
  target: string,
): Promise<{ text: string; channel: ChannelName }> {
  let lastErr: unknown = new Error("all channels failed");
  for (const [name, fn] of CHANNELS) {
    try {
      const out = await fn(text, target);
      if (out) return { text: out, channel: name };
      lastErr = new Error(`${name} empty result`);
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn(
    `  [translate] all channels failed: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
  );
  throw lastErr;
}

/** 智能通道：gtx → 统一 LLM 层（Gemini 主力 + 智谱兜底）双通道降级。供摘要/洞察/标题多语言翻译等使用。 */
export async function translateTextSmart(text: string, target: string): Promise<string> {
  return (await smartWithMeta(text, target)).text;
}

export async function translatePending(
  rows: TranslatableRow[],
  getCached: (titles: string[]) => Promise<Map<string, string>>,
  saveCached: (pairs: { title: string; titleZh: string }[]) => Promise<void>,
  applyUpdates: (updates: { id: string; titleZh: string }[]) => Promise<void>,
): Promise<TranslationOutcome> {
  const outcome: TranslationOutcome = { updates: [], failed: 0, viaFallback: 0 };
  if (rows.length === 0) return outcome;

  const uniqueTitles = [...new Set(rows.map((r) => r.title))];
  const cached = await getCached(uniqueTitles);

  const byTitle = new Map<string, string>(cached);
  const needFetch: string[] = [];
  for (const title of uniqueTitles) {
    if (!byTitle.has(title)) {
      if (needFetch.length < MAX_NEW_PER_RUN) needFetch.push(title);
      else outcome.failed++;
    }
  }

  let consecutiveFailures = 0;
  const freshPairs: { title: string; titleZh: string }[] = [];
  for (const title of needFetch) {
    try {
      const { text: zh, channel } = await smartWithMeta(title, "zh-CN");
      if (channel !== "gtx") outcome.viaFallback++;
      byTitle.set(title, zh);
      freshPairs.push({ title, titleZh: zh });
      consecutiveFailures = 0;
    } catch (err) {
      if (consecutiveFailures === 0) {
        console.warn(
          `  [translate] first failure detail: ${err instanceof Error ? err.message : err}`,
        );
      }
      consecutiveFailures++;
      outcome.failed++;
      if (consecutiveFailures >= 5) break;
    }
    await sleep(REQUEST_GAP_MS);
  }

  if (freshPairs.length > 0) await saveCached(freshPairs);

  for (const row of rows) {
    const zh = byTitle.get(row.title);
    if (zh) outcome.updates.push({ id: row.id, titleZh: zh });
  }

  await applyUpdates(outcome.updates);
  return outcome;
}
