import { cookies, headers as nextHeaders } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/header";
import { BriefingPanel } from "@/components/briefing-panel";
import { NewsFeed } from "@/components/news-feed";
import { getBriefMeta, listArticles } from "@/lib/news";
import { withFreshness } from "@/lib/article-utils";
import type { FeedFilters } from "@/lib/types";

export const runtime = "edge";

interface HomeSearchParams {
  category?: string | string[];
  source?: string | string[];
  q?: string | string[];
  hours?: string | string[];
}

function pick(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}

async function readPrefCats(): Promise<string[]> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("radar_cats")?.value;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as unknown;
    if (!Array.isArray(parsed)) return [];
    const valid = new Set(["official", "media-cn", "media-en", "community"]);
    return parsed.filter(
      (x): x is string => typeof x === "string" && valid.has(x),
    );
  } catch {
    return [];
  }
}

export default async function HomePage(props: { searchParams: Promise<HomeSearchParams> }) {
  const t = await getTranslations("home");
  const sp = (await props.searchParams) as HomeSearchParams;
  const [prefCats] = await Promise.all([readPrefCats(), nextHeaders()]);

  const urlCategory = pick(sp.category);
  const filters: FeedFilters = {
    categories: urlCategory ? [] : prefCats,
    category: urlCategory,
    sourceId: pick(sp.source),
    q: pick(sp.q),
    hours: Number(pick(sp.hours)) || 72,
  };

  const [page, meta] = await Promise.all([listArticles(filters), getBriefMeta()]);
  const items = withFreshness(page.items);
  const feedKey = `${filters.categories?.join(",") ?? ""}|${urlCategory ?? ""}|${filters.sourceId ?? ""}|${filters.q ?? ""}|${filters.hours ?? ""}`;

  return (
    <>
      <Header activeCategory={urlCategory} q={filters.q} />
      <main className="mx-auto w-full max-w-[720px] px-4 pb-16">
        <BriefingPanel meta={meta} activeCategories={filters.categories ?? []} />

        {(filters.q || filters.sourceId || filters.categories!.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5 animate-fade-up">
            {filters.q && (
              <span className="px-2.5 py-0.5 rounded-md bg-neon-soft text-accent font-mono text-[11px]">
                Q={filters.q}
              </span>
            )}
            {filters.sourceId && (
              <span className="px-2.5 py-0.5 rounded-md bg-neon-soft text-accent font-mono text-[11px]">
                SRC={filters.sourceId}
              </span>
            )}
            {filters.categories!.map((c) => (
              <span key={c} className="px-2.5 py-0.5 rounded-md bg-neon-soft text-accent font-mono text-[11px]">
                CAT={c.toUpperCase()}
              </span>
            ))}
          </div>
        )}

        <section className="animate-fade-up">
          <div className="flex items-center gap-3 pb-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted">
              {t("timeline")}
            </span>
            <span aria-hidden className="h-px flex-1 bg-line" />
            <span className="font-mono text-[11px] tabular-nums text-fg-muted">
              {items.length} {t("entries")}
            </span>
          </div>
          <NewsFeed
            key={feedKey}
            initialItems={items}
            initialCursor={page.nextCursor}
            filters={filters}
          />
        </section>
      </main>
      <footer className="pb-12 pt-8 border-t border-line/60">
        <p className="text-center text-xs text-fg-muted">
          <span className="brand-gradient-text font-semibold">{t("footerBrand")}</span>
          {t("footerNote")},{" "}
          <a href="https://cataito.com" className="hover:text-accent transition-colors">
            Cataito
          </a>
          {t("footerSource")}
        </p>
      </footer>
    </>
  );
}