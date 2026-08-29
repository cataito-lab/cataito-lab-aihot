import {
  getPendingTitleTranslations,
  applyTitleTranslationUpdates,
  type TitleLang,
} from "./db";
import { translateTextSmart } from "./translate";

const MAX_ROWS_PER_RUN = 25;
const REQUEST_GAP_MS = 150;
const TARGETS: Record<TitleLang, string> = { ja: "ja", es: "es", fr: "fr" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function translateTitlesPending(
  limit = MAX_ROWS_PER_RUN,
): Promise<number> {
  const rows = await getPendingTitleTranslations(limit);
  if (rows.length === 0) return 0;

  const updates: { id: string; lang: TitleLang; text: string }[] = [];
  let failures = 0;

  for (const row of rows) {
    for (const lang of row.missing) {
      try {
        const text = await translateTextSmart(row.title, TARGETS[lang]);
        if (text) updates.push({ id: row.id, lang, text });
      } catch (err) {
        failures++;
        if (failures <= 2) {
          console.warn(
            `  [title-i18n] ${row.id}/${lang}: ${err instanceof Error ? err.message : err}`,
          );
        }
        if (failures >= 8) {
          console.warn("  [title-i18n] too many failures, aborting this run");
          await applyTitleTranslationUpdates(updates);
          return updates.length;
        }
      }
      await sleep(REQUEST_GAP_MS);
    }
  }

  await applyTitleTranslationUpdates(updates);
  console.log(
    `  [title-i18n] rows=${rows.length} translated=${updates.length} failed=${failures}`,
  );
  return updates.length;
}
