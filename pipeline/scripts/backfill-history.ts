import "../src/env";
import { getDb, setEventKey, countSummariesToday } from "../src/db";
import { extractEventMeta } from "../src/summarize";
import { clusterEvents } from "../src/cluster";
import type { SummarizableRow } from "../src/summarize";

const MIN_CONTENT_CHARS = 80;
const MAX_CALLS = 190; // 给每日事件综合摘要留余量，避免突破 neurons 预算
const BIG_WINDOW_H = 24 * 365 * 10; // 10 年：覆盖全部历史

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 优先用正文；缺失时用已有的摘要（中文优先，其次英文）作为抽取上下文
function pickContent(...cands: unknown[]): string | null {
  const ok = cands.filter(
    (c): c is string => typeof c === "string" && c.length >= MIN_CONTENT_CHARS,
  );
  if (ok.length === 0) return null;
  return ok.sort((a, b) => b.length - a.length)[0];
}

async function countOnly(): Promise<void> {
  const total = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM articles WHERE summary IS NOT NULL`,
  });
  const unkeyed = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM articles WHERE summary IS NOT NULL AND event_key IS NULL`,
  });
  const events = await getDb().execute({ sql: `SELECT COUNT(*) AS n FROM events` });
  const multi = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM events WHERE source_count >= 2`,
  });
  console.log(
    `summarized(total)=${total.rows[0].n}  unkeyed=${unkeyed.rows[0].n}  events=${events.rows[0].n}  multiSource=${multi.rows[0].n}`,
  );
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "dry") {
    await countOnly();
    return;
  }
  const windowHours = Number(arg && arg !== "reset" ? arg : BIG_WINDOW_H);

  const baseUsed = await countSummariesToday();
  const allowed = Math.max(0, MAX_CALLS - baseUsed);
  const cutoff = new Date(Date.now() - windowHours * 3_600_000).toISOString();

  const rs = await getDb().execute({
    sql: `SELECT a.id, a.title, a.title_zh, s.name AS source_name,
                 a.article_content, a.summary, a.summary_en, COALESCE(s.authority, 60) AS authority
          FROM articles a JOIN sources s ON s.id = a.source_id
          WHERE a.summary IS NOT NULL AND a.event_key IS NULL AND a.published_at >= ?
          ORDER BY a.published_at DESC`,
    args: [cutoff],
  });
  console.log(
    `[backfill-history] candidates=${rs.rows.length} window=${windowHours}h baseUsed=${baseUsed} allowedCalls=${allowed}`,
  );

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let calls = 0;
  for (const row of rs.rows) {
    if (calls >= allowed) {
      console.log("  [backfill] 达到每日调用上限，停止（再次运行可继续）");
      break;
    }
    const rid = String(row.id);
    const content = pickContent(row.article_content, row.summary, row.summary_en);
    if (!content) {
      skipped++;
      continue;
    }
    const item: SummarizableRow = {
      id: rid,
      title: String(row.title),
      titleZh: row.title_zh == null ? null : String(row.title_zh),
      sourceName: String(row.source_name),
      content,
      authority: Number(row.authority ?? 60),
    };
    try {
      const meta = await extractEventMeta(item);
      const ek = meta?.eventKey ? meta.eventKey : null;
      await setEventKey(rid, ek, meta?.entities ?? null);
      processed++;
    } catch (err) {
      console.warn(`  [backfill] ${rid}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
    calls++;
    await sleep(120);
  }
  console.log(
    `[backfill-history] processed=${processed} skipped=${skipped} failed=${failed} calls=${calls}`,
  );

  // 全量重聚类：清空派生的 events 表与 article.event_id，从 event_key 干净重建
  console.log("[backfill-history] 清空 events 表 + 重置 articles.event_id，执行全量重聚类");
  await getDb().execute({ sql: `DELETE FROM events` });
  await getDb().execute({ sql: `UPDATE articles SET event_id = NULL` });

  const cluster = await clusterEvents(windowHours);
  console.log(`[backfill-history] cluster=${JSON.stringify(cluster)}`);

  const ev = await getDb().execute({
    sql: `SELECT e.event_key, e.source_count, COALESCE(e.summary, '') AS summary
          FROM events e WHERE e.source_count >= 2 ORDER BY e.source_count DESC LIMIT 30`,
  });
  console.log(`[backfill-history] 形成的多源事件数: ${ev.rows.length}`);
  for (const r of ev.rows) {
    const s = String(r.summary);
    console.log(`  ${r.event_key}  sources=${r.source_count}  synth=${s ? s.slice(0, 50) + "…" : "(待合成)"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
