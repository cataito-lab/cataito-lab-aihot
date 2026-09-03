import "./env";
import pLimit from "p-limit";
import { fetchRss } from "./fetchers/rss";
import { fetchGoogleNews } from "./fetchers/google-news";
import { fetchHnAlgolia } from "./fetchers/hn-algolia";
import { fetchReddit } from "./fetchers/reddit";
import { fetchTwitter } from "./fetchers/twitter";
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
  getSourceHealth,
  markSourceOutcomes,
} from "./db";
import { translatePending } from "./translate";
import { summarizePending } from "./summarize";
import { enrichContent } from "./enrich-content";
import { translateSummariesPending } from "./summary-translate";
import { translateInsightsPending } from "./insight-translate";
import { translateTitlesPending } from "./title-translate";
import { clusterEvents } from "./cluster";
import type { FetchResult, RawItem, SourceDef } from "./types";

function parseArgs(): { windowHours: number; dryRun: boolean } {
  let windowHours = 24;
  let dryRun = false;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.match(/^--window-hours=(\d+(?:\.\d+)?)$/);
    if (eq) {
      windowHours = Number(eq[1]);
      continue;
    }
    if (arg === "--window-hours" && argv[i + 1] && /^\d+(?:\.\d+)?$/.test(argv[i + 1])) {
      windowHours = Number(argv[i + 1]);
      i++;
      continue;
    }
    if (arg === "--dry-run") dryRun = true;
  }
  return { windowHours, dryRun };
}

async function fetchSource(source: SourceDef, windowHours: number): Promise<FetchResult> {
  try {
    switch (source.fetcher) {
      case "rss":
        return { sourceId: source.id, items: await fetchRss(source, windowHours) };
      case "google-news":
        return { sourceId: source.id, items: await fetchGoogleNews(source, windowHours) };
      case "hn-algolia":
        return { sourceId: source.id, items: await fetchHnAlgolia(source, windowHours) };
      case "reddit":
        return { sourceId: source.id, items: await fetchReddit(source, windowHours) };
      case "twitter":
        return { sourceId: source.id, items: await fetchTwitter(source, windowHours) };
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

  // 源级熔断：冷却中的源本轮跳过（连续失败 ≥3 次后指数退避，最长 12h，成功即复位）
  let activeSources = sources;
  if (!dryRun) {
    try {
      const health = await getSourceHealth();
      const now = Date.now();
      activeSources = sources.filter((s) => {
        const h = health.get(s.id);
        if (h?.nextAttemptAt && new Date(h.nextAttemptAt).getTime() > now) {
          console.log(`  [circuit] ${s.id} cooling down until ${h.nextAttemptAt} (streak=${h.failStreak})`);
          return false;
        }
        return true;
      });
    } catch {
      // 首次运行 schema 未就绪：不熔断，全部尝试
    }
  }

  console.log(
    `[pipeline] ${sources.length} enabled sources (${activeSources.length} active after circuit-break) | window=${windowHours}h | dryRun=${dryRun}`,
  );

  const limit = pLimit(5);
  const results = await Promise.all(activeSources.map((s) => limit(() => fetchSource(s, windowHours))));

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
  await markSourceOutcomes(results.map((r) => ({ sourceId: r.sourceId, ok: !r.error })));

  const runId = `run-${Date.now()}`;
  await startRun(runId);

  const newRows = await (async () => {
    const existing = await filterNewIds(withIds.map(({ id }) => id));
    return withIds.filter(({ id }) => !existing.has(id));
  })();

  // C8 enrich：对 title-only 条目抓源文正文，让下游 LLM 摘要有正文可分析
  const enriched = await enrichContent(newRows);

  const inserted = await insertArticles(
    enriched.map(({ id, item }) => ({
      id,
      sourceId: item.sourceId,
      title: item.title,
      url: item.url,
      author: item.author,
      publishedAt: item.publishedAt,
      sourceTimezone: item.sourceTimezone,
      estimated: item.estimated,
      articleContent: item.articleContent,
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
  let translateStats: { ok: number; failed: number } | undefined;
  if (toTranslate.length > 0) {
    const t = await translatePending(
      toTranslate,
      getTitleTranslations,
      saveTitleTranslations,
      applyTranslationUpdates,
    );
    console.log(
      `  [translate] updated=${t.updates.length} failed=${t.failed} fallback=${t.viaFallback}`,
    );
    translateStats = { ok: t.updates.length, failed: t.failed };
  }

  const summarizable = await getRecentWithoutSummary(windowHours, 40);
  await summarizePending(summarizable);
  await translateSummariesPending();
  await translateInsightsPending();
  await translateTitlesPending();
  await clusterEvents(windowHours);

  // 判定本轮是否算成功：
  // - hardFail：所有源都抓失败 → 真故障
  // - totalSeen=0 且非 hardFail：本轮无新内容（正常情况，例如凌晨低活跃）→ 仍记 ok，让首页"数据更新于"正常刷新
  // - 部分源失败但抓到内容：ok
  const hardFail = results.length > 0 && results.every((r) => r.error);
  const ok = (results.length === 0 && !hardFail) ||
    (totalSeen === 0 && !hardFail) ||
    (!hardFail && failedFeeds.length < results.length);
  if (!ok) {
    console.error("[pipeline] run marked failed: hardFail=", hardFail, "totalSeen=", totalSeen, "failedFeeds=", failedFeeds.length, "of", results.length);
  }
  if (totalSeen === 0 && !hardFail) {
    console.warn("[pipeline] total_seen=0 — no fresh items this round; run still counts as success so the site clock refreshes.");
  }
  await finishRun(runId, {
    inserted,
    totalSeen,
    failedFeeds,
    ok,
    translateOk: translateStats?.ok,
    translateFailed: translateStats?.failed,
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
