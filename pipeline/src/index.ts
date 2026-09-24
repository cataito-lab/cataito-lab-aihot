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
  getSummaryTier,
  getSummaryBacklog,
  getSourceHealth,
  markSourceOutcomes,
} from "./db";
import { translatePending } from "./translate";
import { summarizePending, MAX_PER_RUN } from "./summarize";
import { llmQuotaBreakerOpen } from "./llm";
import { enrichContent } from "./enrich-content";
import { translateSummariesPending } from "./summary-translate";
import { translateInsightsPending } from "./insight-translate";
import { translateTitlesPending } from "./title-translate";
import { clusterEvents } from "./cluster";
import { decodeEntities, sanitizeTitle } from "./text";
import type { FetchResult, RawItem, SourceDef } from "./types";

/** 摘要在途窗口：published_at 超过它就不再是"正常队列"，改由盲区回捞兜住 */
const SUMMARY_WINDOW_H = 24;
/** 首屏保鲜层：近这么多小时内的文章最新优先，额度占在途队列的 60% */
const FRESH_WINDOW_H = Number(process.env.ENRICH_FRESH_WINDOW_H ?? 6);

function parseArgs(): {
  windowHours: number;
  dryRun: boolean;
  noEnrich: boolean;
  enrichOnly: boolean;
  backlog: number;
} {
  let windowHours = 24;
  let dryRun = false;
  let noEnrich = false;
  let enrichOnly = false;
  let backlog = 12; // §27.4：盲区回捞额度。2026-09-19 25→12：与 MAX_PER_RUN 回调同步，
  // 单轮真正能跑完比单轮吞更多重要（旧值下整轮超时被 kill，摘要一条未写）
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
    if (arg === "--no-enrich") noEnrich = true;
    if (arg === "--enrich-only") enrichOnly = true;
    const bk = arg.match(/^--backlog=(\d+)$/);
    if (bk) {
      backlog = Number(bk[1]);
      continue;
    }
    if (arg === "--backlog" && argv[i + 1] && /^\d+$/.test(argv[i + 1])) {
      backlog = Number(argv[i + 1]);
      i++;
      continue;
    }
  }
  if (noEnrich && enrichOnly) {
    throw new Error("--no-enrich 与 --enrich-only 互斥，只能选一个运行阶段");
  }
  return { windowHours, dryRun, noEnrich, enrichOnly, backlog };
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
  const { windowHours, dryRun, noEnrich, enrichOnly, backlog } = parseArgs();

  // --enrich-only：只跑 LLM 增强队列（标题回填翻译、摘要、摘要/洞察/标题补译），
  // 不抓取、不入库、不写 fetch_logs。由 enrich-news 工作流低频调用，
  // 让高频的抓取运行不必背着 LLM 耗时（这是每日调度断流的根因，见 update-news.yml）。
  if (enrichOnly) {
    await ensureSchema();
    // F3（2026-09-19）优雅时间预算：整轮在 deadline 之前完成即正常退出（exit 0），
    // 避免被 GitHub timeout 砍成半截（status=cancelled）。每跨一个阶段前检查预算，
    // 超预算则不再开新阶段、保留已完成部分正常收尾。默认 70min（< workflow timeout 90 留 20min 收尾余量）。
    const budgetMs = Number(process.env.ENRICH_BUDGET_MIN ?? 70) * 60_000;
    const startedAt = Date.now();
    const withinBudget = () => Date.now() - startedAt < budgetMs;

    // === F2：顺序重排，摘要/洞察优先（用户可见的最新内容），存量标题回译放最后 ===
    // 队列分三层（2026-09-24，TECH_SPEC §27.4 修订）：免费档额度每天只够产出约 1 小时的量，
    // 原先整条队列严格先进先出，缺口全部砸在队尾＝最新文章上，前端首屏连续 23 小时空白
    // （实测最后一条洞察停在 24h 前发布的文章）。现在：
    //   层1 近 FRESH_WINDOW_H 小时：最新优先，保首屏保鲜；
    //   层2 窗口内更早的（到 24h）：最旧优先，保证没有文章会滑出窗口而永久漏评；
    //   层3 超窗盲区回捞（>36h，§27.1）：独立额度，不与在途队列抢。
    // 层1 没吃饱时额度自动让给层2。
    const backlogQuota = Math.max(0, Math.min(backlog, MAX_PER_RUN - 10));
    const liveQuota = MAX_PER_RUN - backlogQuota;
    const freshQuota = Math.ceil(liveQuota * 0.6);
    const freshRows = await getSummaryTier({
      newerThanHours: FRESH_WINDOW_H,
      limit: freshQuota,
      order: "desc",
    });
    const restRows = await getSummaryTier({
      newerThanHours: SUMMARY_WINDOW_H,
      olderThanHours: FRESH_WINDOW_H,
      limit: liveQuota - freshRows.length,
      order: "asc",
    });
    const backlogRows = await getSummaryBacklog(backlogQuota);
    const queueRows = [...freshRows, ...restRows, ...backlogRows];
    const sumStats = await summarizePending(queueRows);
    const summarized = sumStats.done;

    // 多语补译（新摘要/洞察的外语译文）优先于老标题回译；预算不足则跳过，不影响洞察本身
    let summaryTranslated = 0;
    let insightsTranslated = 0;
    let titlesTranslated = 0;
    // 熔断开启＝当日额度已耗尽（见 llm.ts），后续每个阶段都只会必败，跳过以把本轮从
    // 70 分钟压到几分钟，也就不再堵住并发组导致后续 run 被系统 cancelled（满屏假失败）。
    const breakerOpen = llmQuotaBreakerOpen();
    if (breakerOpen) {
      console.warn("  [enrich-only] LLM 熔断中（当日额度已耗尽），跳过补译/回译阶段");
    }
    if (!breakerOpen && withinBudget()) summaryTranslated = await translateSummariesPending();
    if (!breakerOpen && withinBudget()) insightsTranslated = await translateInsightsPending();
    if (!breakerOpen && withinBudget()) titlesTranslated = await translateTitlesPending();

    // 存量英文标题→中文回译（非紧急的旧标题译名）放最后，150→60：不再挤占摘要时间预算
    let backfillCount = 0;
    if (!breakerOpen && withinBudget()) {
      const backfill = await getUntranslated(60);
      backfillCount = backfill.length;
      if (backfill.length > 0) {
        const t = await translatePending(
          backfill,
          getTitleTranslations,
          saveTitleTranslations,
          applyTranslationUpdates,
        );
        console.log(
          `  [translate] updated=${t.updates.length} failed=${t.failed} fallback=${t.viaFallback}`,
        );
      }
    }
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(
      `\n[enrich-only] summarize=${summarized}/${freshRows.length}(fresh)+${restRows.length}(rest)+${backlogRows.length}(backlog) ` +
        `summaryTranslate=${summaryTranslated} insightTranslate=${insightsTranslated} titleTranslate=${titlesTranslated} ` +
        `titleBackfill=${backfillCount} elapsed=${elapsedSec}s budget_hit=${!withinBudget()}`,
    );

    // 假绿修复（2026-09-22）：2026-09-20 商汤 key 封禁后，本工作流连续 48h 每轮
    // 「5 连败即 break → exit 0」，Actions 全绿但洞察零产出，无人发现。
    // 规则：队列有 LLM 可做的行（排除无正文行）、成功 0、且有 LLM 失败 → 判 LLM 链路故障，exit 1 报红。
    const llmWork = sumStats.done + sumStats.failures;
    if (llmWork > 0 && sumStats.done === 0) {
      console.error(
        `❌ [enrich-only] LLM 链路全挂：尝试 ${llmWork} 次全部失败（failures=${sumStats.failures}）。` +
          " 请检查各 provider key 限额/封禁（日志中 [llm] 行含具体状态码）。",
      );
      process.exit(1);
    }
    return;
  }

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
  // 双重编码的 HTML 实体（&amp;#8216; 等）入库前统一解码，覆盖全部 fetcher；
  // 标题同时做悬空引号清洗（上游截题会产生未闭合引号，见 text.ts）
  allItems = allItems.map((it) => ({
    ...it,
    title: sanitizeTitle(decodeEntities(it.title)),
    articleContent: it.articleContent ? decodeEntities(it.articleContent) : undefined,
  }));
  const totalSeen = allItems.length;
  allItems = allItems.filter((it) => {
    const src = sources.find((s) => s.id === it.sourceId);
    // 正文联合过滤：dedicated 源的可疑标题会用已有正文复核（RSS 源正文现成）
    return src ? isAiRelated(it.title, src.dedicated, it.articleContent) : false;
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

  // C8 enrich：正文缺失或短于 MIN_BODY_CHARS 的条目回源抓正文，让下游 LLM 摘要有正文可分析
  // （中文 RSS 只给一句导语，判空放行不了它们）。--no-enrich 只跳过 LLM 阶段，本步骤照跑。
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
  // --no-enrich 时不做存量回填（150 篇的 LLM 大头由 enrich-news 低频工作流负责），
  // 只翻译本轮新入库的标题，保证高频抓取运行几分钟内结束。
  const backfill = noEnrich ? [] : await getUntranslated(Math.max(0, 150 - newEnRows.length));
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

  if (!noEnrich) {
    // 本地/手动全量运行才走这条内联路径（Actions 已拆成 --no-enrich + --enrich-only），
    // 保持先进先出即可，不必分层。
    const summarizable = await getSummaryTier({ newerThanHours: windowHours, limit: 40 });
    await summarizePending(summarizable);
    await translateSummariesPending();
    await translateInsightsPending();
    await translateTitlesPending();
  }
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
