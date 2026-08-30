import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { httpFetch } from "./net";
import { llmChat } from "./llm";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

const MAX_NEW_PER_RUN = 100;
const REQUEST_GAP_MS = 150;

/**
 * 术语表 / Terminology Glossary（Localization Contract #8：品牌名/产品名/技术术语遵循固定译法）。
 * 翻译时优先采用本表约定，避免机械翻译把专有名词译错。
 */
type Glossary = Record<string, Record<string, string>>;
const GLOSSARY: Glossary = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "data", "glossary.json"), "utf8");
    const parsed = JSON.parse(raw) as Glossary;
    delete (parsed as Record<string, unknown>)._comment;
    return parsed;
  } catch {
    return {};
  }
})();

const GLOSSARY_LOCALES = new Set(["zh", "ja", "es", "fr"]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 术语表安全网：翻译结果里若仍残留英文规范术语（如 "Large Language Model"），
 * 且本表对该 locale 有固定译法，则替换为本地表单。品牌名（form === canonical）
 * 因不会进入此分支，由 LLM 提示词保障不被翻译。
 */
function applyGlossary(text: string, target: string): string {
  if (!GLOSSARY_LOCALES.has(target)) return text;
  let out = text;
  for (const [canonical, forms] of Object.entries(GLOSSARY)) {
    const wanted = forms[target];
    if (!wanted || wanted === canonical) continue;
    out = out.replace(new RegExp(escapeRegExp(canonical), "gi"), wanted);
  }
  return out;
}

/** 取术语表提示词片段（仅含目标语言相关条目），注入 LLM 翻译指令。 */
function glossaryPrompt(target: string): string {
  if (!GLOSSARY_LOCALES.has(target)) return "";
  const lines = Object.entries(GLOSSARY)
    .map(([canonical, forms]) => {
      const wanted = forms[target];
      if (!wanted || wanted === canonical) return null;
      return `  - ${canonical} → ${wanted}`;
    })
    .filter((x): x is string => x !== null);
  if (lines.length === 0) return "";
  return `\n\nUse these fixed terminology renderings (do NOT translate the left side differently):\n${lines.join("\n")}`;
}

const LANG_NAMES: Record<string, string> = {
  "zh-CN": "Simplified Chinese",
  "zh": "Simplified Chinese",
  en: "English",
  ja: "Japanese",
  es: "Spanish",
  fr: "French",
};

/**
 * 目标语言校验（Localization Contract：AI 输出语言验证）。
 * 翻译结果若明显不是目标语言（脚本不符），视为污染，必须拒绝/重试。
 * - ja：必须含假名（日语必有かな）
 * - zh：必须含汉字
 * - en/es/fr：以拉丁字母为主（非拉丁占比 < 30%），否则视为串语言
 */
function looksLikeTargetLang(text: string, target: string): boolean {
  if (!text.trim()) return false;
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  const kana = (text.match(/[぀-ヿ]/g) ?? []).length;
  const latin = (text.match(/[A-Za-zÀ-ɏ]/g) ?? []).length;
  const nonLatin = cjk + kana;
  const denom = nonLatin + latin + 1;
  switch (target) {
    case "ja":
      return kana > 0;
    case "zh":
    case "zh-CN":
      return cjk > 0;
    case "en":
    case "es":
    case "fr":
      return nonLatin / denom < 0.3;
    default:
      return true;
  }
}

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
      "Keep product/company/person names in their original form. Output ONLY the translation, with no surrounding quotes or extra commentary." +
      glossaryPrompt(target),
    text,
    { maxTokens: 400 },
  );
  return applyGlossary(out.replace(/^["'「『]|["'」』]$/g, "").trim(), target);
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
      const out = applyGlossary(await fn(text, target), target);
      if (!out) {
        lastErr = new Error(`${name} empty result`);
        continue;
      }
      if (!looksLikeTargetLang(out, target)) {
        console.warn(
          `  [translate] ${name} 输出语言不符目标 ${target}，重试其他通道`,
        );
        lastErr = new Error(`${name} language mismatch`);
        continue;
      }
      return { text: out, channel: name };
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn(
    `  [translate] 所有通道失败或语言不符目标 ${target}: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
  );
  throw lastErr;
}

/**
 * 智能通道：gtx → 统一 LLM 层（Gemini 主力 + 智谱兜底）双通道降级，
 * 并做目标语言校验（Localization Contract）。若全部通道失败或输出语言不符，
 * 返回 null（调用方应跳过写入，避免污染数据库）。
 */
export async function translateTextSmart(text: string, target: string): Promise<string | null> {
  try {
    return (await smartWithMeta(text, target)).text;
  } catch {
    return null;
  }
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
