import { httpFetch } from "../net";
import type { RawItem, SourceDef } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ai-news-pipeline/0.1";

interface RedditData {
  data: {
    children: Array<{
      kind: "t3";
      data: {
        id: string;
        title: string;
        url: string;
        created_utc: number;
        author: string;
      };
    }>;
  };
}

export async function fetchReddit(source: SourceDef, windowHours: number): Promise<RawItem[]> {
  // Reddit RSS (.rss) frequently fails on restricted runners / anti-bot.
  // Fall back to Reddit's public JSON API which is far more reliable.
  const sub = source.feedUrl?.match(/\/r\/([^/]+)\.rss$/)?.[1];
  if (!sub) return [];
  const url = `https://www.reddit.com/r/${sub}/new/.json?limit=50`;
  const res = await httpFetch(url, {
    headers: {
      "User-Agent": `ai-news-pipeline/0.1 (+${UA})`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(18000),
  });
  if (!res.ok) throw new Error(`reddit ${sub} HTTP ${res.status}`);
  const data = (await res.json()) as unknown as RedditData;
  if (!data?.data?.children) return [];

  const cutoff = Date.now() - windowHours * 3_600_000;
  const out: RawItem[] = [];
  for (const node of data.data.children) {
    const d = node.data;
    if (!d.title || !d.url) continue;
    const dt = new Date(d.created_utc * 1000);
    if (dt.getTime() < cutoff) continue;
    const link = d.url.startsWith("http")
      ? d.url.replace("/?ref=share", "")
      : `https://www.reddit.com/r/${sub}/comments/${d.id}/`;
    out.push({
      sourceId: source.id,
      title: d.title.replace(/\s+/g, " ").trim(),
      url: link,
      publishedAt: dt.toISOString(),
      author: d.author,
    });
  }
  return out;
}