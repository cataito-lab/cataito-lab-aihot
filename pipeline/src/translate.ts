import { httpFetch } from "./net";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const CF_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const FALLBACK_MODEL = "@cf/meta/m2m100-1.2b";

const MAX_NEW_PER_RUN = 100;
const REQUEST_GAP_MS = 150;

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

/** 首选：Google gtx 免费端点。注意其对数据中心 IP 常限流，失败由上层降级。 */
async function translateGtx(text: string, target = "zh-CN", attempts = 3): Promise<string> {
  const url =
    `${ENDPOINT}?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
  let delayMs = 1000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const res = await httpFetch(url, {
      headers: { "User-Agent": "ai-news-pipeline/0.1" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429 || res.status === 503) {
      if (attempt === attempts - 1) break;
      await sleep(delayMs);
      delayMs *= 2;
      continue;
    }
    if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) throw new Error("translate bad payload");
    const segments = (data[0] as unknown[])
      .map((seg) => (Array.isArray(seg) ? String(seg[0] ?? "") : ""))
      .join("");
    return segments.trim();
  }
  throw new Error("translate rate-limited after retries");
}

/** 兜底：Cloudflare Workers AI m2m100。复用摘要的账户凭据，成本约 0.6~0.8 neurons/条。 */
async function translateWorkersAi(text: string, target = "zh"): Promise<string> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_AI_API_TOKEN;
  if (!accountId || !token) throw new Error("workers-ai skipped (no creds)");
  const res = await httpFetch(`${CF_API_BASE}/${accountId}/ai/run/${FALLBACK_MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, target_lang: target }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`workers-ai HTTP ${res.status}`);
  const data = (await res.json()) as { result?: { translated_text?: unknown } };
  const out = data.result?.translated_text;
  const zh = Array.isArray(out)
    ? out.map((s) => String(s ?? "")).join("")
    : typeof out === "string"
      ? out
      : "";
  return zh.trim();
}

/** 智能通道：gtx 单次尝试，失败即降级 Workers AI。供标题与摘要多语言翻译共用。 */
export async function translateTextSmart(text: string, target: string): Promise<string> {
  try {
    const out = await translateGtx(text, target, 1);
    if (out) return out;
  } catch {
    // 降级
  }
  return translateWorkersAi(text, target);
}

/** 空结果视为失败：绝不把空串写入缓存或文章，否则该条目会被永久跳过（translated 永远为 0）。 */
export async function translateText(text: string, target: string): Promise<string> {
  return translateGtx(text, target);
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
      // gtx 首选（质量更好）；数据中心 IP 常被限流，单次尝试不重试（重试交给兜底通道，避免逐条空耗）
      let zh = "";
      try {
        zh = await translateGtx(title, "zh-CN", 1);
      } catch {
        zh = "";
      }
      if (!zh) {
        zh = await translateWorkersAi(title);
        if (zh) outcome.viaFallback++;
      }
      if (!zh) throw new Error("empty translation");
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
