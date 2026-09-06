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
/** 误译映射：{ locale: { 错误译法: 正确形式 } }，来自 glossary.json 的 "_mistakes" 键。
 *  gtx 机械翻译会把 Claude 译成「克劳德」、agent 译成「代理」——译文里已没有
 *  英文原词可匹配 applyGlossary 的正向替换，必须用反向表修正。 */
type Mistakes = Record<string, Record<string, string>>;

const GLOSSARY_RAW = (() => {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, "..", "data", "glossary.json"), "utf8");
    return JSON.parse(raw) as Glossary & { _mistakes?: Mistakes };
  } catch {
    return {} as Glossary & { _mistakes?: Mistakes };
  }
})();

const GLOSSARY: Glossary = (() => {
  const { _mistakes, ...rest } = GLOSSARY_RAW;
  void _mistakes;
  return rest as Glossary;
})();

const MISTAKES: Mistakes = GLOSSARY_RAW._mistakes ?? {};

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

/** 误译安全网：把 gtx 等机械通道产出的固定错误译法替换回正确形式。
 *  按错误形式长度降序替换，避免「智能代理」被「代理」类短词条抢先截断。 */
function applyMistakes(text: string, target: string): string {
  const table = MISTAKES[target];
  if (!table) return text;
  let out = text;
  for (const wrong of Object.keys(table).sort((a, b) => b.length - a.length)) {
    out = out.split(wrong).join(table[wrong]);
  }
  return out;
}

/** 取术语表提示词片段（仅含目标语言相关条目），注入 LLM 翻译指令。
 *  分两组：固定译法（canonical → 译法）与保留原文（品牌/习惯术语不翻译，
 *  如 Claude 不得译成「克劳德」、Agent 习惯保留英文）。 */
function glossaryPrompt(target: string): string {
  if (!GLOSSARY_LOCALES.has(target)) return "";
  const fixed: string[] = [];
  const keep: string[] = [];
  for (const [canonical, forms] of Object.entries(GLOSSARY)) {
    if (canonical.startsWith("_")) continue;
    const wanted = forms[target];
    if (!wanted) continue;
    if (wanted === canonical) {
      if (/[A-Za-z]/.test(canonical)) keep.push(`  - ${canonical}`);
    } else {
      fixed.push(`  - ${canonical} → ${wanted}`);
    }
  }
  const parts: string[] = [];
  if (fixed.length > 0) {
    parts.push(
      `Use these fixed terminology renderings (do NOT translate the left side differently):\n${fixed.join("\n")}`,
    );
  }
  if (keep.length > 0) {
    parts.push(
      `Keep these terms in their ORIGINAL form, never translate or transliterate them:\n${keep.join("\n")}`,
    );
  }
  return parts.length > 0 ? `\n\n${parts.join("\n\n")}` : "";
}

/* ============================================================
 * Translation Guard（2026-09-06，针对「LLM→法学硕士」「Claude→克劳德」级误译）：
 * 1) protectTerms：送翻前把术语表条目替换成私有区占位符，机器翻译通道
 *    无法再改写术语/品牌；翻译后按表还原。占位符丢失 = 通道污染，判失败。
 * 2) lostProtectedBrands：译文丢了「保留原文」类品牌词（如 Siri/Claude）
 *    即判失败，换通道或放弃写入——宁可不翻译，也不要错误翻译。
 * ============================================================ */
const PROT_OPEN = "\uE000";
const PROT_CLOSE = "\uE001";

interface ProtectedText {
  masked: string;
  restore: (translated: string) => string;
}

function protectTerms(text: string, target: string): ProtectedText {
  if (!GLOSSARY_LOCALES.has(target)) {
    return { masked: text, restore: (t) => t };
  }
  const entries = Object.entries(GLOSSARY)
    .filter(([canonical]) => canonical.length >= 2)
    .map(([canonical, forms]) => ({ canonical, wanted: forms[target] ?? canonical }))
    .sort((a, b) => b.canonical.length - a.canonical.length);

  const found: string[] = [];
  let masked = text;
  for (const { canonical, wanted } of entries) {
    const re = new RegExp(escapeRegExp(canonical), "gi");
    const token = `${PROT_OPEN}${found.length}${PROT_CLOSE}`;
    const next = masked.replace(re, token);
    if (next !== masked) {
      found.push(wanted);
      masked = next;
    }
  }
  return {
    masked,
    restore: (translated: string) => {
      let out = translated;
      for (let i = 0; i < found.length; i++) {
        const token = `${PROT_OPEN}${i}${PROT_CLOSE}`;
        if (!out.includes(token)) {
          throw new Error(`gtx lost protected term #${i} (${found[i]})`);
        }
        out = out.split(token).join(found[i]);
      }
      return out;
    },
  };
}

/** 品牌保全 QA：源文含「保留原文」品牌词而译文没有 → 视为该通道翻译失败。 */
function lostProtectedBrands(source: string, out: string, target: string): string[] {
  if (target !== "zh" && target !== "zh-CN" && target !== "ja") return [];
  const lost: string[] = [];
  for (const [canonical, forms] of Object.entries(GLOSSARY)) {
    if (!/[A-Za-z]{3,}/.test(canonical)) continue;
    if (forms[target] !== canonical) continue;
    const re = new RegExp(escapeRegExp(canonical), "i");
    if (re.test(source) && !re.test(out)) lost.push(canonical);
  }
  return lost;
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

/** 通道 1：Google gtx 免费端点，质量最好。对数据中心 IP 常限流，故只做单次尝试。
 *  术语/品牌先经占位符保护再送翻（Translation Guard），防止 LLM→法学硕士级误译。 */
async function translateGtx(text: string, target: string): Promise<string> {
  const { masked, restore } = protectTerms(text, target);
  const url =
    `${ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(masked)}`;
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
  return restore(segments.trim());
}

/** 通道 2（兜底）：用统一 LLM 层（Gemini 主力 + 智谱兜底）做指令式翻译。
 *  仅在 gtx 免费端点被限流（数据中心 IP 常触发）时启用，质量接近 gtx。
 *  Prompt V2：AI 领域上下文约束（缩写按 AI 语境解读、品牌保留原文、
 *  语义忠实优先于直译、不得增删信息）。 */
async function translateViaLlm(text: string, target: string): Promise<string> {
  const langName = LANG_NAMES[target] ?? target;
  const out = await llmChat(
    `You are a professional AI-industry news translator. Translate the user text into ${langName}.\n` +
      "Rules:\n" +
      "1. Preserve company names, product names, model names and person names in their original form.\n" +
      "2. Interpret abbreviations and acronyms according to the AI/technology context (e.g. LLM = Large Language Model, NEVER a law degree).\n" +
      "3. Never map a technical acronym to an unrelated common-domain meaning.\n" +
      "4. Preserve the semantic meaning; for metaphor/wordplay in headlines prefer semantic fidelity over literal translation.\n" +
      "5. Produce natural phrasing suitable for professional technology news.\n" +
      "6. Do not add, drop or invent information.\n" +
      "Output ONLY the translation, with no surrounding quotes or extra commentary." +
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
      const out = applyMistakes(applyGlossary(await fn(text, target), target), target);
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
      const lost = lostProtectedBrands(text, out, target);
      if (lost.length > 0) {
        console.warn(
          `  [translate] ${name} 译文丢失品牌词 [${lost.join(", ")}]，重试其他通道`,
        );
        lastErr = new Error(`${name} lost brands: ${lost.join("/")}`);
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
