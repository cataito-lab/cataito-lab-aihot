import "../src/env";
import { getDb, setEventKey, countSummariesToday } from "../src/db";
import { extractEventMeta } from "../src/summarize";
import { clusterEvents } from "../src/cluster";
import type { SummarizableRow } from "../src/summarize";

const MIN_CONTENT_CHARS = 80;
const MAX_CALLS = 190; // 给事件综合摘要(≤8)留余量，避免突破每日 200

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const windowHours = Number(process.argv[2] ?? 24);
  const baseUsed = await countSummariesToday();
  const allowed = Math.max(0, MAX_CALLS - baseUsed);
  const cutoff = new Date(Date.now() - windowHours * 3_600_000).toISOString();

  const rs = await getDb().execute({
    sql: `SELECT a.id, a.title, a.title_zh, s.name AS source_name, a.article_content, COALESCE(s.authority, 60) AS authority
          FROM articles a JOIN sources s ON s.id = a.source_id
          WHERE a.summary IS NOT NULL AND a.event_key IS NULL
            AND a.article_content IS NOT NULL AND length(a.article_content) >= ?
            AND a.published_at >= ?
          ORDER BY a.published_at DESC`,
    args: [MIN_CONTENT_CHARS, cutoff],
  });

  console.log(`[backfill] candidates=${rs.rows.length} window=${windowHours}h baseUsed=${baseUsed} allowedCalls=${allowed}`);

  let processed = 0;
  let failed = 0;
  let calls = 0;
  for (const row of rs.rows) {
    if (calls >= allowed) {
      console.log("  [backfill] 达到每日调用上限，停止");
      break;
    }
    const rid = String(row.id);
    const item: SummarizableRow = {
      id: rid,
      title: String(row.title),
      titleZh: row.title_zh == null ? null : String(row.title_zh),
      sourceName: String(row.source_name),
      content: String(row.article_content),
      authority: Number(row.authority ?? 60),
    };
    try {
      const meta = await extractEventMeta(item);
      await setEventKey(rid, meta?.eventKey ?? null, meta?.entities ?? null);
      processed++;
    } catch (err) {
      console.warn(`  [backfill] ${rid} error: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
    calls++;
    await sleep(120);
  }
  console.log(`[backfill] done processed=${processed} failed=${failed} modelCalls=${calls}`);

  const cluster = await clusterEvents(windowHours);
  console.log(`[backfill] ${JSON.stringify(cluster)}`);

  const ev = await getDb().execute({
    sql: `SELECT e.id, e.event_key, e.source_count, COALESCE(e.summary, '') AS summary
          FROM events e WHERE e.source_count >= 2 ORDER BY e.source_count DESC LIMIT 20`,
  });
  console.log(`[backfill] multi-source events formed: ${ev.rows.length}`);
  for (const r of ev.rows) {
    const s = String(r.summary);
    console.log(`  ${r.event_key}  sources=${r.source_count}  synth=${s ? s.slice(0, 50) + "…" : "(pending/none)"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
