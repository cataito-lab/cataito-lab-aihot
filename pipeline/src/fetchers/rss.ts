import Parser from "rss-parser";
import { httpFetch } from "../net";
import type { RawItem, SourceDef } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ai-news-pipeline/0.1";

const parser = new Parser({
  headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
});

const MAX_PER_SOURCE = 50;
const TIMEOUT_MS = 20000;

function cleanXml(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

async function fetchFeedText(feedUrl: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await httpFetch(feedUrl, {
        headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return cleanXml(await res.text());
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export async function fetchRss(source: SourceDef, windowHours: number): Promise<RawItem[]> {
  if (!source.feedUrl) return [];
  const xml = await fetchFeedText(source.feedUrl);
  const feed = await parser.parseString(xml);
  const cutoffMs = Date.now() - windowHours * 3_600_000;
  const items: RawItem[] = [];
  for (const entry of feed.items) {
    if (!entry.title || !entry.link) continue;
    const published = entry.isoDate ? new Date(entry.isoDate) : null;
    if (published && Number.isNaN(published.getTime())) continue;
    const publishedAt = (published ?? new Date()).toISOString();
    if (published && published.getTime() < cutoffMs) continue;
    items.push({
      sourceId: source.id,
      title: cleanTitle(entry.title),
      url: entry.link,
      publishedAt,
      author: entry.creator,
    });
    if (items.length >= MAX_PER_SOURCE) break;
  }
  return items;
}
