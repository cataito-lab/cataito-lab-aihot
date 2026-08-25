import "../src/env";
import { getDb } from "../src/db";

(async () => {
  const db = await getDb();
  const rs = await db.execute(
    "SELECT started_at, ok, inserted, total_seen FROM fetch_logs ORDER BY started_at DESC LIMIT 4"
  );
  for (const r of rs.rows) console.log(`${r.started_at} ok=${r.ok} seen=${r.total_seen}`);
})();
