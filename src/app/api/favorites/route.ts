import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { toFeedArticle, type ArticleRow } from "@/lib/news";

export const runtime = "edge";

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
             a.title, a.title_zh, a.summary, a.summary_en, a.summary_ja,
             a.summary_es, a.summary_fr, a.url, a.author,
             a.published_at, a.fetched_at,
             a.key_points, a.industry_impact, a.score_final
      FROM articles a
      JOIN sources s ON s.id = a.source_id
      WHERE a.id IN (${placeholders})
      ORDER BY a.published_at DESC, a.id DESC
    `;
    const rs = await db.execute({ sql, args: ids as string[] });
    const articles = (rs.rows ?? []).map((row) =>
      toFeedArticle(row as unknown as ArticleRow),
    );
    return Response.json({ articles });
  } catch (err) {
    console.error("[api/favorites]", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}