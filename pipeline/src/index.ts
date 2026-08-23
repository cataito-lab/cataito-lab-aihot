import "./env";
import pLimit from "p-limit";
import { fetchRss } from "./fetchers/rss";
import { fetchHnAlgolia } from "./fetchers/hn-algolia";
import { fetchReddit } from "./fetchers/reddit";
import { assignIds } from "./dedup";
import { isAiRelated } from "./filter";
import { loadSources } from "./config";
import {
  ensureSchema,
  seedSources,
  filterNewIds,
  insertArticles,
  startRun,
  finishRun,
  getTitleTranslations,
  saveTitleTranslations,
  applyTranslationUpdates,
  getUntranslated,
  getRecentWithoutSummary,
} from "./db";
import { translatePending } from "./translate";
import { summarizePending } from "./summarize";
import type { FetchResult, RawItem, SourceDef } from "./types";

function parseArgs(): { windowHours: number; dryRun: boolean } {
  let windowHours = 24;
  let dryRun = false;
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--window-hours=(\d+(?:\.\d+)?)$/);
    if (m) windowHours = Number(m[1]);
    if (arg === "--dry-run") dryRun = true;
  }
  return { windowHours, dryRun };
}

async function fetchSource(source: SourceDef, windowHours: number): Promise<FetchResult> {
  try {
    switch (source.fetcher) {
      case "rss":
        return { sourceId: source.id, items: await fetchRss(source, windowHours) };
      case "hn-algolia":
        return { sourceId: source.id, items: await fetchHnAlgolia(source, windowHours) };
      case "reddit":
        return { sourceId: source.id, items: await fetchReddit(source, windowHours) };
      default:
        return { sourceId: source.id, items: [], error: `fetcher '${source.fetcher}' not implemented` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { sourceId: source.id, items: [], error: message };
  }
}

async function main(): Promise<void> {
  const { windowHours, dryRun } = parseArgs();
  const sources = loadSources().filter((s) => s.enabled && s.fetcher !== "html" && s.fetcher !== "bridge");
  console.log(`[pipeline] ${sources.length} enabled sources | window=${windowHours}h | dryRun=${dryRun}`);

  const limit = pLimit(5);
  const results = await Promise.all(sources.map((s) => limit(() => fetchSource(s, windowHours))));

  const failedFeeds = results.filter((r) => r.error).map((r) => `${r.sourceId}: ${r.error}`);
  for (const f of failedFeeds) console.warn(`  [fail] ${f}`);

  let allItems: RawItem[] = results.flatMap((r) => r.items);
  const totalSeen = allItems.length;
  allItems = allItems.filter((it) => {
    const src = sources.find((s) => s.id === it.sourceId);
    return src ? isAiRelated(it.title, src.dedicated) : false;
  });

  const withIds = assignIds(allItems);

  if (dryRun) {
    console.log(`\n[dry-run] raw=${totalSeen}, after filter/dedup=${withIds.length}`);
    for (const r of results.sort((a, b) => b.items.length - a.items.length)) {
      console.log(`  ${r.sourceId.padEnd(20)} ${String(r.items.length).padStart(3)} items`);
    }
    console.log("\n[dry-run] sample:");
    for (const { item } of withIds.slice(0, 10)) {
      console.log(`  - [${item.sourceId}] ${item.title}`);
    }
    return;
  }

  await ensureSchema();
  await seedSources(loadSources());

  const runId = `run-${Date.now()}`;
  await startRun(runId);

  const newRows = await (async () => {
    const existing = await filterNewIds(withIds.map(({ id }) => id));
    return withIds.filter(({ id }) => !existing.has(id));
  })();

  const inserted = await insertArticles(
    newRows.map(({ id, item }) => ({
      id,
      sourceId: item.sourceId,
      title: item.title,
      url: item.url,
      author: item.author,
      publishedAt: item.publishedAt,
    })),
  );

  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const newEnRows = newRows
    .filter(({ item }) => sourceById.get(item.sourceId)?.lang === "en")
    .map(({ id, item }) => ({ id, title: item.title }));
  const backfill = await getUntranslated(Math.max(0, 150 - newEnRows.length));
  const seenIds = new Set<string>();
  const toTranslate = [...newEnRows, ...backfill].filter((r) =>
    seenIds.has(r.id) ? false : (seenIds.add(r.id), true),
  );
  if (toTranslate.length > 0) {
    const t = await translatePending(
      toTranslate,
      getTitleTranslations,
      saveTitleTranslations,
      applyTranslationUpdates,
    );
    console.log(`  [translate] updated=${t.updates.length} failed=${t.failed}`);
  }

  const summarizable = await getRecentWithoutSummary(windowHours, 40);
  await summarizePending(summarizable);

  const hardFail = results.length > 0 && results.every((r) => r.error);
  await finishRun(runId, {
    inserted,
    totalSeen,
    failedFeeds,
    ok: !hardFail && failedFeeds.length < results.length,
  });
  console.log(
    `\n[pipeline] seen=${totalSeen} candidates=${withIds.length} inserted=${inserted} failedFeeds=${failedFeeds.length}`,
  );
  if (hardFail) {
    console.error(
      "\n[pipeline] FATAL: every source failed to fetch -- this run inserted nothing. " +
        "If you see this repeatedly, check network / proxy (HTTPS_PROXY) and source reachability.",
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("[pipeline] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => process.exit(process.exitCode ?? 0), 100).unref();
  });
