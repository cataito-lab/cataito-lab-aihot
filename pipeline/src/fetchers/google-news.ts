import Parser from "rss-parser";
import { httpFetch } from "../net";
import type { RawItem, SourceDef } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 ai-news-pipeline/0.1";

const parser = new Parser({
  headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
});

const MAX_PER_SOURCE = 50;
const TIMEOUT_MS = 25000;

function cleanXml(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

/** 剥掉 Google News 标题末尾的 " - 来源" 后缀（若存在） */
function cleanTitle(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim();
  const m = t.match(/^(.*?)\s+-\s+[^-]+$/);
  return m ? m[1] : t;
}

function extractText(raw: unknown, maxChars: number): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export async function fetchGoogleNews(source: SourceDef, windowHours: number): Promise<RawItem[]> {
  if (!source.gnQuery) return [];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(source.gnQuery)}&hl=en-US&gl=US&ceid=US:en`;
  let xml: string;
  try {
    const res = await httpFetch(url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = cleanXml(await res.text());
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
  const feed = await parser.parseString(xml);
  const cutoffMs = Date.now() - windowHours * 3_600_000;
  const items: RawItem[] = [];
  for (const entry of feed.items) {
    if (!entry.title || !entry.link) continue;
    const published = entry.isoDate ? new Date(entry.isoDate) : null;
    if (published && Number.isNaN(published.getTime())) continue;
    if (published && published.getTime() < cutoffMs) continue;
    items.push({
      sourceId: source.id,
      title: cleanTitle(entry.title),
      url: entry.link,
      publishedAt: (published ?? new Date()).toISOString(),
      sourceTimezone: "UTC",
      author: undefined,
      articleContent:
        extractText((entry as Record<string, unknown>).content, 800) ||
        extractText(entry.description, 800) ||
        undefined,
    });
    if (items.length >= MAX_PER_SOURCE) break;
  }
  return items;
}
