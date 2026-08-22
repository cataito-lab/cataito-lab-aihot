import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import type { FeedArticle } from "@/lib/types";

export const runtime = "edge";

interface Row {
  id: unknown;
  source_id: unknown;
  source_name: unknown;
  category: unknown;
  lang: unknown;
  title: unknown;
  title_zh: unknown;
  summary: unknown;
  url: unknown;
  author: unknown;
  published_at: unknown;
  fetched_at: unknown;
}

function toArticle(row: Row): FeedArticle {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    sourceName: String(row.source_name),
    category: String(row.category),
    lang: String(row.lang),
    title: String(row.title),
    titleZh: row.title_zh == null ? null : String(row.title_zh),
    summary: row.summary == null ? null : String(row.summary),
    url: String(row.url),
    author: row.author == null ? null : String(row.author),
    publishedAt: String(row.published_at),
    fetchedAt: row.fetched_at == null ? undefined : String(row.fetched_at),
  };
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const idsRaw = sp.get("ids") ?? "";
  const ids = idsRaw.split(",").map((x) => x.trim()).filter(Boolean);

  if (ids.length === 0) {
    return Response.json({ articles: [] });
  }
  if (ids.length > 200) {
    return new Response("too many ids", { status: 400 });
  }

  try {
    const db = await getDb();
    const placeholders = ids.map(() => "?").join(",");
    const sql = `
      SELECT a.id, a.source_id, s.name AS source_name, s.category, s.lang,
             a.title, a.title_zh, a.summary, a.url, a.author,
             a.published_at, a.fetched_at
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE a.id IN (${placeholders})
      ORDER BY a.published_at DESC, a.id DESC
    `;
    const rs = await db.execute({ sql, args: ids as string[] });
    const articles = (rs.rows ?? []).map((row) => toArticle(row as unknown as Row));
    return Response.json({ articles });
  } catch (err) {
    console.error("[api/favorites]", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}