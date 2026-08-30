import type { NextRequest } from "next/server";
import { listArticles } from "@/lib/news";
import { locales } from "@/i18n/routing";

export const runtime = "edge";

/**
 * Localization Contract：API 必须显式接收 locale，禁止自行猜测语言。
 * 未提供或非法 locale 直接 400；响应回显 locale 并禁止缓存（新闻实时）。
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const locale = sp.get("locale") ?? "";
  if (!locales.includes(locale as (typeof locales)[number])) {
    return Response.json({ error: "missing or invalid locale" }, { status: 400 });
  }

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
        sort: sp.get("sort") === "importance" ? "importance" : undefined,
      },
      sp.get("cursor") ?? undefined,
      limit,
    );
    return Response.json(
      { locale, ...page },
      { headers: { "Cache-Control": "no-store, must-revalidate" } },
    );
  } catch (err) {
    console.error("[api/news]", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
