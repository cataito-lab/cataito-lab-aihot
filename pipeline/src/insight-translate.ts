import {
  getPendingInsightTranslations,
  applyInsightTranslationUpdates,
  type InsightLang,
  type InsightTranslateRow,
} from "./db";
import { translateTextSmart } from "./translate";

const MAX_ROWS_PER_RUN = 25;
const REQUEST_GAP_MS = 150;
const TARGETS: Record<InsightLang, string> = { ja: "ja", es: "es", fr: "fr" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 将 impact JSON 的每条 audience/description 翻译为目标语言（保留 JSON 结构）。 */
async function translateImpactJson(
  json: string | null,
  target: string,
): Promise<string | null> {
  if (!json) return null;
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return null;
    const out: unknown[] = [];
    for (const x of arr) {
      if (!x || typeof x !== "object") {
        out.push(x);
        continue;
      }
      const o = x as Record<string, unknown>;
      let audience = o.audience;
      if (typeof audience === "string" && audience.trim()) {
        audience = await translateTextSmart(audience, target);
        await sleep(REQUEST_GAP_MS);
      }
      let description = o.description;
      if (typeof description === "string" && description.trim()) {
        description = await translateTextSmart(description, target);
        await sleep(REQUEST_GAP_MS);
      }
      out.push({ ...o, audience, description });
    }
    return JSON.stringify(out);
  } catch {
    return null;
  }
}

export async function translateInsightsPending(
  limit = MAX_ROWS_PER_RUN,
): Promise<number> {
  const rows = await getPendingInsightTranslations(limit);
  if (rows.length === 0) return 0;

  const updates: {
    id: string;
    field: string;
    lang: InsightLang;
    text: string;
  }[] = [];
  let failures = 0;

  const translateField = async (
    row: InsightTranslateRow,
    field: string,
    src: string,
    lang: InsightLang,
  ): Promise<void> => {
    try {
      const text =
        field === "impact"
          ? await translateImpactJson(src, TARGETS[lang])
          : await translateTextSmart(src, TARGETS[lang]);
      if (text) updates.push({ id: row.id, field, lang, text });
    } catch (err) {
      failures++;
      if (failures <= 2) {
        console.warn(
          `  [insight-i18n] ${row.id}/${field}/${lang}: ${err instanceof Error ? err.message : err}`,
        );
      }
      if (failures >= 8) {
        console.warn("  [insight-i18n] too many failures, aborting this run");
        await applyInsightTranslationUpdates(updates);
        throw new Error("abort");
      }
    }
    await sleep(REQUEST_GAP_MS);
  };

  try {
    for (const row of rows) {
      for (const [field, info] of Object.entries(row.fields)) {
        for (const lang of info.missing) {
          await translateField(row, field, info.src!, lang);
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message !== "abort") throw err;
  }

  await applyInsightTranslationUpdates(updates);
  console.log(
    `  [insight-i18n] rows=${rows.length} translated=${updates.length} failed=${failures}`,
  );
  return updates.length;
}
