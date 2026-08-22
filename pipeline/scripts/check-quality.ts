import "../src/env";
import { getDb } from "../src/db";

async function main(): Promise<void> {
  const db = getDb();
  const t = await db.execute(
    "SELECT title_zh FROM articles WHERE title_zh IS NOT NULL ORDER BY published_at DESC LIMIT 6",
  );
  console.log("=== translated titles ===");
  for (const r of t.rows) console.log("  -", r.title_zh);

  const fts = await db.execute(
    "SELECT COUNT(*) AS n FROM articles_fts WHERE articles_fts MATCH 'agent'",
  );
  console.log("FTS 'agent' hits:", fts.rows[0].n);

  const c = await db.execute("SELECT COUNT(*) AS total FROM articles");
  const zh = await db.execute("SELECT COUNT(*) AS n FROM articles WHERE translated = 1");
  console.log(`total=${c.rows[0].total} translated=${zh.rows[0].n}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
