import { listArticles } from "@/lib/news";

export const runtime = "edge";

const RSS_LIMIT = 50;
const SITE_NAME = "AI 热点简报 · aihot.cataito.com";
const SITE_URL = "https://aihot.cataito.com";

function esc(s: string | null): string {
  return (
    (s ?? "")
      // 先转实体再转 &，避免二次转义
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")
  );
}

export async function GET() {
  try {
    const { items } = await listArticles({}, undefined, RSS_LIMIT);

    const itemsXml = items
      .map((a) => {
        const link = a.url || `${SITE_URL}/article/${a.id}`;
        return `  <item>
    <title>${esc(a.titleZh || a.title)}</title>
    <link>${esc(link)}</link>
    <guid isPermaLink="false">${esc(a.id)}</guid>
    <pubDate>${a.publishedAt}</pubDate>
    <source url="${esc(link)}">${esc(a.sourceName)}</source>
    <description>${esc(a.summary || a.titleZh || a.title)}</description>
    <category>${esc(a.category)}</category>
  </item>`;
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${SITE_NAME}</title>
    <link>${SITE_URL}</link>
    <description>全球 AI 行业热点实时聚合。20+ 信源每 30 分钟更新，含中英双语标题与一句话摘要。Part of Cataito AI 生态门户。</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <docs>http://www.rssboard.org/rss-specification</docs>
    <ttl>30</ttl>
    <item>${itemsXml}
  </channel>
</rss>`;

    return new Response(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "public, max-age=300, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    console.error("[rss]", err);
    return new Response("rss error", { status: 500 });
  }
}