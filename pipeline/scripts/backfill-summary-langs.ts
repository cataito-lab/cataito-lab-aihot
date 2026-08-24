import "../src/env";
import { ensureSchema } from "../src/db";
import { translateSummariesPending } from "../src/summary-translate";

const MAX_ROUNDS = Number(process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? 40);

/** 把存量中文摘要回填为 en/ja/es/fr 四语。每轮 25 行，直到无缺口或达到轮数。 */
async function main(): Promise<void> {
  await ensureSchema();
  let total = 0;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const n = await translateSummariesPending();
    total += n;
    if (n === 0) {
      console.log(`[summary:backfill] done at round ${round}, total translated=${total}`);
      return;
    }
    console.log(`[summary:backfill] round ${round}/${MAX_ROUNDS} translated=${n}`);
  }
  console.log(`[summary:backfill] hit round limit, total translated=${total} (rerun to continue)`);
}

main().catch((err) => {
  console.error("[summary:backfill] fatal:", err);
  process.exit(1);
});
