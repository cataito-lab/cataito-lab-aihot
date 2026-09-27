/**
 * emergency-snapshot.ts —— 构建时抓信源生成 public/emergency-feed.json，**完全不碰 Turso**。
 *
 * 用途：2026-09-26 Turso rows-read 超额把整账户读封锁，全站没有可读的数据源，
 * 前端只能渲染空壳。本脚本让首页在库读不到时退回一份「当下真实标题」的静态快照——
 * 没有 AI 洞察、没有 5 语言译文（那些只存在于库里），但时间线是活的、链接可点回原文。
 *
 * 刷新方式不需要任何新基础设施：Cloudflare Pages 的 deploy hook（POST 一个 URL 即重新构建），
 * 用已有的 cron-job.org 定时打即可。每次刷新 = 一次 Pages 构建（免费档 500 次/月）。
 *
 * 硬约束：**任何失败都不许让构建挂掉**。抓不到就保留上一次的快照文件并退出 0，
 * 因为这份文件同时是 `src/lib/emergency-feed.ts` 的静态 import 目标，缺了会直接 build 失败。
 *
 * 用法：npx tsx pipeline/scripts/emergency-snapshot.ts [--hours 72] [--max 250]
 */
import "../src/env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import pLimit from "p-limit";
import { loadSources } from "../src/config";
import { fetchRss } from "../src/fetchers/rss";
import { fetchGoogleNews } from "../src/fetchers/google-news";
import { fetchHnAlgolia } from "../src/fetchers/hn-algolia";
import { fetchReddit } from "../src/fetchers/reddit";
import { fetchTwitter } from "../src/fetchers/twitter";
import { isAiRelated } from "../src/filter";
import { clampPublishedAt } from "../src/db";
import { decodeEntities, sanitizeTitle } from "../src/text";
import type { RawItem, SourceDef } from "../src/types";

export interface SnapshotItem {
  id: string;
  sourceId: string;
  sourceName: string;
  category: string;
  lang: string;
  title: string;
  url: string;
  publishedAt: string;
  excerpt: string | null;
}

export interface Snapshot {
  /** null = 从未成功抓取过（前端据此判断快照不可用） */
  generatedAt: string | null;
  windowHours: number;
  sourcesOk: number;
  sourcesFailed: number;
  items: SnapshotItem[];
}

const OUT_FILE = "public/emergency-feed.json";

function argNum(name: string, fallback: number): number {
  const i = process.argv.indexOf(name);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

async function fetchOne(source: SourceDef, windowHours: number): Promise<RawItem[]> {
  switch (source.fetcher) {
    case "rss":
      return await fetchRss(source, windowHours);
    case "google-news":
      return await fetchGoogleNews(source, windowHours);
    case "hn-algolia":
      return await fetchHnAlgolia(source, windowHours);
    case "reddit":
      return await fetchReddit(source, windowHours);
    case "twitter":
      return await fetchTwitter(source, windowHours);
    default:
      return [];
  }
}

function excerptOf(content: string | undefined): string | null {
  if (!content) return null;
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  return flat.length > 220 ? `${flat.slice(0, 220)}…` : flat;
}

function writeSnapshot(snap: Snapshot): void {
  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify(snap, null, 2)}\n`, "utf8");
}

function emptySnapshot(windowHours: number, why: string): Snapshot {
  console.error(`[snapshot] 本次不可用（${why}），保留占位快照`);
  return { generatedAt: null, windowHours, sourcesOk: 0, sourcesFailed: 0, items: [] };
}

async function collect(windowHours: number, max: number): Promise<Snapshot> {
  const now = new Date().toISOString();
  const sources = loadSources().filter(
    (s) => s.enabled && s.fetcher !== "html" && s.fetcher !== "bridge",
  );
  console.log(`[snapshot] ${sources.length} 个信源，窗口 ${windowHours}h`);

  const limit = pLimit(5);
  let failed = 0;
  const perSource = await Promise.all(
    sources.map((s) =>
      limit(async () => {
        try {
          const items = await fetchOne(s, windowHours);
          return { s, items };
        } catch (err) {
          failed++;
          console.warn(`  [fail] ${s.id}: ${err instanceof Error ? err.message : String(err)}`);
          return { s, items: [] as RawItem[] };
        }
      }),
    ),
  );

  const seen = new Set<string>();
  const items: SnapshotItem[] = [];
  for (const { s, items: raw } of perSource) {
    for (const it of raw) {
      const title = sanitizeTitle(decodeEntities(it.title));
      if (!title || !it.url) continue;
      if (!isAiRelated(title, s.dedicated, it.articleContent)) continue;
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      items.push({
        id: createHash("sha1").update(it.url).digest("hex").slice(0, 16),
        sourceId: s.id,
        sourceName: s.name,
        category: s.category,
        lang: s.lang,
        title,
        url: it.url,
        // 与入库同一口径钳制未来时间戳，否则应急时间线顶部会出现未发生的时刻
        publishedAt: clampPublishedAt(it.publishedAt, now),
        excerpt: excerptOf(it.articleContent ? decodeEntities(it.articleContent) : undefined),
      });
    }
  }

  items.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  const trimmed = items.slice(0, max);
  console.log(
    `[snapshot] ${perSource.length - failed} 源成功 / ${failed} 源失败，${trimmed.length} 条（去重后 ${items.length} 条候选）`,
  );
  return {
    generatedAt: trimmed.length > 0 ? now : null,
    windowHours,
    sourcesOk: perSource.length - failed,
    sourcesFailed: failed,
    items: trimmed,
  };
}

async function main(): Promise<void> {
  const windowHours = argNum("--hours", 72);
  const max = argNum("--max", 250);
  try {
    const snap = await collect(windowHours, max);
    if (snap.generatedAt === null) {
      // 一条都没抓到：多半是网络/代理问题。保留上一份可用快照，别把首页打回空壳。
      const prev = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : null;
      if (prev && JSON.parse(prev).items?.length) {
        console.warn("[snapshot] 本次零命中，沿用上一次快照");
        return;
      }
      writeSnapshot(emptySnapshot(windowHours, "本次零命中且无历史快照"));
      return;
    }
    writeSnapshot(snap);
    console.log(`[snapshot] 已写入 ${OUT_FILE}`);
  } catch (err) {
    // 这里绝不能抛出去：本脚本挂在 prebuild 上，抛错会让整次部署失败
    console.error("[snapshot] 异常（已忽略，不影响构建）:", err);
    if (!existsSync(OUT_FILE)) writeSnapshot(emptySnapshot(windowHours, "脚本异常"));
  }
}

main();
