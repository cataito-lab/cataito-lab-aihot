import "../src/env";
import { clusterEvents } from "../src/cluster";

async function main(): Promise<void> {
  const windowHours = Number(process.argv[2] ?? 24);
  const r = await clusterEvents(windowHours);
  console.log(`[recluster] ${JSON.stringify(r)}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
