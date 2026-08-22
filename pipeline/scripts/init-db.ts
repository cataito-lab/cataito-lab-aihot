import "../src/env";
import { ensureSchema, seedSources } from "../src/db";
import { loadSources } from "../src/config";

async function main(): Promise<void> {
  await ensureSchema();
  await seedSources(loadSources());
  console.log("[db:init] schema created and sources seeded");
}

main().catch((err) => {
  console.error("[db:init] fatal:", err);
  process.exit(1);
});
