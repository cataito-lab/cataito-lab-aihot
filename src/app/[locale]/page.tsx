import { getTranslations } from "next-intl/server";
import { Header } from "@/components/header";
import { BriefingPanel } from "@/components/briefing-panel";
import { NewsFeed } from "@/components/news-feed";
import { TzNote } from "@/components/tz-note";
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

export default async function HomePage(
  props: {
    params: Promise<{ locale: string }>;
    searchParams: Promise<HomeSearchParams>;
  },
) {
  const t = await getTranslations("home");
  const ts = await getTranslations("site");
  const { locale } = await props.params;
  const sp = (await props.searchParams) as HomeSearchParams;

  const urlCategory = pick(sp.category);
  const filters: FeedFilters = {
    category: urlCategory,
    sourceId: pick(sp.source),
    q: pick(sp.q),
    hours: Number(pick(sp.hours)) || 72,
  };

  const [page, meta] = await Promise.all([listArticles(filters), getBriefMeta()]);
  const items = withFreshness(page.items);
  const feedKey = `${urlCategory ?? ""}|${filters.sourceId ?? ""}|${filters.q ?? ""}|${filters.hours ?? ""}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("timeline"),
    description: ts("description"),
    url: `https://aihot.cataito.com/${locale}`,
    inLanguage: locale,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.slice(0, 30).map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: locale === "zh" ? (a.titleZh ?? a.title) : a.title,
        url: a.url,
      })),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header activeCategory={urlCategory} q={filters.q} />
      <main className="site-main">
        <BriefingPanel meta={meta} />

        {(filters.q || filters.sourceId || filters.category) && (
          <div className="mb-6 flex flex-wrap gap-1.5 animate-fade-up -mt-4">
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
            {filters.category && (
              <span className="px-2.5 py-0.5 rounded-md bg-neon-soft text-accent font-mono text-[11px]">
                CAT={filters.category.toUpperCase()}
              </span>
            )}
          </div>
        )}

        <section className="animate-fade-up">
          <NewsFeed
            key={feedKey}
            initialItems={items}
            initialCursor={page.nextCursor}
            filters={filters}
          />
        </section>
      </main>
      <footer className="pb-10 pt-6 border-t border-line/60">
        <p className="text-center text-xs text-fg-muted">
          <span className="font-semibold text-fg">{t("footerBrand")}</span>
          {t("footerNote")},{" "}
          <a href="https://cataito.com" className="hover:text-accent transition-colors">
            Cataito
          </a>
          {t("footerSource")}
        </p>
        <TzNote />
      </footer>
    </>
  );
}
