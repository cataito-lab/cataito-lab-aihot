import type { NextRequest } from "next/server";
import { listArticles } from "@/lib/news";

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const limitRaw = Number(sp.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? limitRaw : 50;

  try {
    const catsRaw = sp.get("cats");
    const categories = catsRaw
      ? catsRaw.split(",").map((c) => c.trim()).filter(Boolean)
      : undefined;
    const page = await listArticles(
      {
        category: sp.get("category") ?? undefined,
        categories,
        sourceId: sp.get("source") ?? undefined,
        q: sp.get("q") ?? undefined,
        hours: Number(sp.get("hours")) || undefined,
      },
      sp.get("cursor") ?? undefined,
      limit,
    );
    return Response.json(page);
  } catch (err) {
    console.error("[api/news]", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
