import { httpFetch } from "./net";

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

const MAX_NEW_PER_RUN = 100;
const REQUEST_GAP_MS = 150;

export interface TranslatableRow {
  id: string;
  title: string;
}

export interface TranslationOutcome {
  updates: { id: string; titleZh: string }[];
  failed: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateOnce(text: string): Promise<string> {
  const url =
    `${ENDPOINT}?client=gtx&sl=auto&tl=zh-CN&dt=t&q=${encodeURIComponent(text)}`;
  let delayMs = 1000;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await httpFetch(url, {
      headers: { "User-Agent": "ai-news-pipeline/0.1" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 429 || res.status === 503) {
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

export async function translatePending(
  rows: TranslatableRow[],
  getCached: (titles: string[]) => Promise<Map<string, string>>,
  saveCached: (pairs: { title: string; titleZh: string }[]) => Promise<void>,
  applyUpdates: (updates: { id: string; titleZh: string }[]) => Promise<void>,
): Promise<TranslationOutcome> {
  const outcome: TranslationOutcome = { updates: [], failed: 0 };
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
      const zh = await translateOnce(title);
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
