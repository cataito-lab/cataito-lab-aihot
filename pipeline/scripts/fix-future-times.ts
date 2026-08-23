import { readFileSync } from "fs";
import { createClient } from "@libsql/client";

const env = readFileSync(".env.local", "utf-8").split("\n").map((l) => l.split("="));
const url = env.find(([k]) => k === "TURSO_DATABASE_URL")![1].trim();
const token = env.find(([k]) => k === "TURSO_AUTH_TOKEN")![1].trim();

const c = createClient({ url, authToken: token });

async function main() {
  // 找出 published_at 晚于 fetched_at 超过 5 分钟的记录，回退到 fetched_at
  const r = await c.execute(
    "SELECT id, published_at, fetched_at, title FROM articles WHERE julianday(published_at) > julianday(fetched_at) + 5/1440"
  );
  console.log(`[fix-time] skewed rows: ${r.rows.length}`);
  let fixed = 0;
  for (const row of r.rows) {
    console.log(`  - ${row.id.slice(0, 8)} | was=${row.published_at} | -> ${row.fetched_at}`);
    await c.execute(
      "UPDATE articles SET published_at = fetched_at WHERE id = ?",
      [row.id]
    );
    fixed++;
  }
  console.log(`[fix-time] updated ${fixed} rows`);
  await c.close();
}

main().catch((e) => { console.error(e); process.exit(1); });