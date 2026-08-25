import "../src/env";
import { fetchRss } from "../src/fetchers/rss";
import { fetchHnAlgolia } from "../src/fetchers/hn-algolia";
import { fetchReddit } from "../src/fetchers/reddit";
import { assignIds } from "../src/dedup";
import { isAiRelated } from "../src/filter";
import { loadSources } from "../src/config";
import { filterNewIds } from "../src/db";
import pLimit from "p-limit";
import type { FetchResult, RawItem, SourceDef } from "../src/types";

async function fetchSource(source: SourceDef, windowHours: number): Promise<FetchResult> {
  try {
    switch (source.fetcher) {
      case "rss": return { sourceId: source.id, items: await fetchRss(source, windowHours) };
      case "hn-algolia": return { sourceId: source.id, items: await fetchHnAlgolia(source, windowHours) };
      case "reddit": return { sourceId: source.id, items: await fetchReddit(source, windowHours) };
      default: return { sourceId: source.id, items: [] };
    }
  } catch (err) {
    return { sourceId: source.id, items: [], error: err instanceof Error ? err.message : String(err) };
  }
}

(async () => {
  const sources = loadSources().filter((s) => s.enabled && s.fetcher !== "html" && s.fetcher !== "bridge");
  const limit = pLimit(5);
  const results = await Promise.all(sources.map((s) => limit(() => fetchSource(s, 24))));
  let all: RawItem[] = results.flatMap((r) => r.items);
  all = all.filter((it) => {
    const src = sources.find((s) => s.id === it.sourceId);
    return src ? isAiRelated(it.title, src.dedicated) : false;
  });
  const withIds = assignIds(all);
  const existing = await filterNewIds(withIds.map(({ id }) => id));
  const newRows = withIds.filter(({ id }) => !existing.has(id));
  console.log(`新文章数: ${newRows.length}`);

  for (const { id, item } of newRows) {
    const bad: string[] = [];
    if (typeof id !== "string") bad.push(`id=${typeof id}`);
    if (typeof item.sourceId !== "string") bad.push(`sourceId=${typeof item.sourceId}`);
    if (typeof item.title !== "string") bad.push(`title=${typeof item.title}`);
    if (typeof item.url !== "string") bad.push(`url=${typeof item.url}`);
    if (typeof item.publishedAt !== "string") bad.push(`publishedAt=${typeof item.publishedAt}`);
    if (item.author !== undefined && typeof item.author !== "string") bad.push(`author=${typeof item.author}`);
    if (item.articleContent !== undefined && typeof item.articleContent !== "string") bad.push(`articleContent=${typeof item.articleContent}`);
    if (bad.length) {
      console.log(`\n[坏数据] ${item.sourceId}`);
      console.log(`  字段问题: ${bad.join(", ")}`);
      console.log(`  title=${JSON.stringify(item.title)?.slice(0, 80)}`);
      console.log(`  url=${JSON.stringify(item.url)?.slice(0, 100)}`);
      console.log(`  publishedAt=${JSON.stringify(item.publishedAt)}`);
    }
  }
  console.log("\n诊断完成");
  process.exit(0);
})();
