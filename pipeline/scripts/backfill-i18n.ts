/**
 * 精准回填：分页扫描 articles 全表，补全缺失的本地化列（摘要 / AI Insight：
 * key_change · forward_signal · impact）对应的 ja / es / fr 翻译。
 * 主翻译通道为免费 gtx 端点，无需 LLM key。仅写入翻译列，不抓取、不插入新文章。
 * 幂等：已翻译的列会被跳过，可重复运行。
 *
 * 用法：npm run translate:all
 * 目标库由 .env.local 的 TURSO_DATABASE_URL 决定（生产库）。
 */
import "../src/env";
import pLimit from "p-limit";
import { translateTextSmart } from "../src/translate";
import { getDb, applySummaryTranslationUpdates, applyInsightTranslationUpdates, applyTitleTranslationUpdates } from "../src/db";

const BATCH = 40;
const CONCURRENCY = 5;
const GAP_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SUMMARY_LANGS = ["ja", "es", "fr"] as const;
const INSIGHT_LANGS = ["ja", "es", "fr"] as const;

type Row = Record<string, unknown>;
const str = (v: unknown): string | null => (v == null ? null : String(v));

async function translateImpact(srcJson: string | null, target: string): Promise<string | null> {
  if (!srcJson) return null;
  try {
    const arr = JSON.parse(srcJson);
    if (!Array.isArray(arr)) return null;
    const out: unknown[] = [];
    for (const x of arr) {
      if (!x || typeof x !== "object") { out.push(x); continue; }
      const o = x as Record<string, unknown>;
      let audience = o.audience;
      if (typeof audience === "string" && audience.trim()) {
        audience = (await translateTextSmart(audience, target)) ?? audience;
        await sleep(GAP_MS);
      }
      let description = o.description;
      if (typeof description === "string" && description.trim()) {
        description = (await translateTextSmart(description, target)) ?? description;
        await sleep(GAP_MS);
      }
      out.push({ ...o, audience, description });
    }
    return JSON.stringify(out);
  } catch {
    return null;
  }
}

async function backfillSummaries(): Promise<number> {
  const limit = pLimit(CONCURRENCY);
  let offset = 0;
  let total = 0;
  for (;;) {
    const rs = await getDb().execute({
      sql: `SELECT id, summary, summary_ja, summary_es, summary_fr FROM articles WHERE summary IS NOT NULL ORDER BY published_at DESC LIMIT ? OFFSET ?`,
      args: [BATCH, offset],
    });
    const tasks: Promise<{ id: string; lang: typeof SUMMARY_LANGS[number]; text: string } | null>[] = [];
    for (const row of rs.rows as Row[]) {
      const src = str(row.summary);
      if (!src) continue;
      const id = str(row.id)!;
      for (const lang of SUMMARY_LANGS) {
        if (str(row[`summary_${lang}`])) continue;
        tasks.push(limit(async () => {
          const t = await translateTextSmart(src, lang);
          return t ? { id, lang, text: t } : null;
        }));
      }
    }
    const resolved = (await Promise.all(tasks)).filter((x): x is { id: string; lang: typeof SUMMARY_LANGS[number]; text: string } => x !== null);
    if (resolved.length) await applySummaryTranslationUpdates(resolved);
    total += resolved.length;
    console.log(`  [summaries] offset=${offset} 本批翻译 ${resolved.length}/${tasks.length}`);
    if (rs.rows.length < BATCH) break;
    offset += BATCH;
  }
  return total;
}

const INSIGHT_FIELDS = ["key_change", "forward_signal", "impact"] as const;

async function backfillInsights(): Promise<number> {
  const limit = pLimit(CONCURRENCY);
  let offset = 0;
  let total = 0;
  for (;;) {
    const rs = await getDb().execute({
      sql: `SELECT id,
                   key_change, key_change_en, key_change_ja, key_change_es, key_change_fr,
                   forward_signal, forward_signal_en, forward_signal_ja, forward_signal_es, forward_signal_fr,
                   impact, impact_en, impact_ja, impact_es, impact_fr
            FROM articles ORDER BY published_at DESC LIMIT ? OFFSET ?`,
      args: [BATCH, offset],
    });
    const tasks: Promise<{ id: string; field: string; lang: typeof INSIGHT_LANGS[number]; text: string } | null>[] = [];
    for (const row of rs.rows as Row[]) {
      const id = str(row.id)!;
      for (const field of INSIGHT_FIELDS) {
        const src = str((row as Row)[`${field}_en`]) ?? str((row as Row)[field]);
        if (!src) continue;
        const isImpact = field === "impact";
        for (const lang of INSIGHT_LANGS) {
          if (str((row as Row)[`${field}_${lang}`])) continue;
          tasks.push(limit(async () => {
            const t = isImpact ? await translateImpact(src, lang) : await translateTextSmart(src, lang);
            return t ? { id, field, lang, text: t } : null;
          }));
        }
      }
    }
    const resolved = (await Promise.all(tasks)).filter((x): x is { id: string; field: string; lang: typeof INSIGHT_LANGS[number]; text: string } => x !== null);
    if (resolved.length) await applyInsightTranslationUpdates(resolved);
    total += resolved.length;
    console.log(`  [insights] offset=${offset} 本批翻译 ${resolved.length}/${tasks.length}`);
    if (rs.rows.length < BATCH) break;
    offset += BATCH;
  }
  return total;
}

async function main(): Promise<void> {
  console.log("[translate:all] 开始分页补全本地化（ja/es/fr）…");
  const s = await backfillSummaries();
  console.log(`  [summaries] 已补 ${s} 条`);
  const i = await backfillInsights();
  console.log(`  [insights] 已补 ${i} 条`);
  console.log("[translate:all] 完成。");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error("[translate:all] 错误：", err); process.exit(1); });
