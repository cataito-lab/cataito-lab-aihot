import "../src/env";
import { getDb } from "../src/db";

async function main(): Promise<void> {
  const rs = await getDb().execute(
    "SELECT source_id, COUNT(*) AS n FROM articles GROUP BY source_id ORDER BY n DESC",
  );
  console.log("=== articles by source ===");
  for (const row of rs.rows) console.log(`  ${String(row.source_id).padEnd(20)} ${row.n}`);

  const recent = await getDb().execute(
    "SELECT published_at, title FROM articles ORDER BY published_at DESC LIMIT 8",
  );
  console.log("\n=== latest 8 ===");
  for (const row of recent.rows) console.log(`  ${row.published_at}  ${row.title}`);

  const logs = await getDb().execute("SELECT run_id, inserted, total_seen, failed_feeds FROM fetch_logs");
  console.log("\n=== fetch_logs ===");
  for (const row of logs.rows) {
    console.log(`  ${row.run_id} inserted=${row.inserted} seen=${row.total_seen}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
