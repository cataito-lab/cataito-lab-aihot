import { isAiRelated } from "../filter";
import { httpFetch } from "../net";
import type { RawItem } from "../types";

const API = "https://hn.algolia.com/api/v1/search_by_date";

interface AlgoliaHit {
  objectID: string;
  title: string | null;
  url: string | null;
  created_at: string;
  points: number | null;
  num_comments: number | null;
  author: string;
}

const MIN_POINTS = 10;
const MIN_COMMENTS = 2;
const MAX_PER_RUN = 30;

export async function fetchHnAlgolia(_source: { id: string }, windowHours: number): Promise<RawItem[]> {
  const cutoffSec = Math.floor((Date.now() - windowHours * 3_600_000) / 1000);
  const url = `${API}?tags=story&hitsPerPage=100&numericFilters=created_at_i>${cutoffSec}`;
  const res = await httpFetch(url, {
    headers: { "User-Agent": "ai-news-pipeline/0.1" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HN Algolia HTTP ${res.status}`);
  const data = (await res.json()) as { hits: AlgoliaHit[] };
  const items: RawItem[] = [];
  for (const hit of data.hits) {
    if (!hit.title) continue;
    if (!isAiRelated(hit.title, false)) continue;
    if ((hit.points ?? 0) < MIN_POINTS && (hit.num_comments ?? 0) < MIN_COMMENTS) continue;
    const link = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
    items.push({
      sourceId: "hackernews",
      title: hit.title,
      url: link,
      publishedAt: hit.created_at,
      author: hit.author,
    });
    if (items.length >= MAX_PER_RUN) break;
  }
  return items;
}
