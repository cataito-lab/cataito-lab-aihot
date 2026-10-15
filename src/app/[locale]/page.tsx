import { getTranslations } from "next-intl/server";
import { Header } from "@/components/header";
import { BriefingPanel } from "@/components/briefing-panel";
import { NewsFeed } from "@/components/news-feed";
import { TzNote } from "@/components/tz-note";
import { getBriefMeta, listArticles, emptyBriefMeta, emptyFeedPage } from "@/lib/news";
import { emergencyItems } from "@/lib/emergency-feed";
import { DegradedNote } from "@/components/degraded-note";
import { EmergencyFeedList } from "@/components/emergency-feed-list";
import { withFreshness } from "@/lib/article-utils";
import { pickTitle } from "@/lib/i18n";
import { getDailyTop } from "@/lib/news-v2";
import { PickCard } from "@/components/v2/pick-card";
import type { BriefMeta, FeedFilters, FeedPage } from "@/lib/types";

export const runtime = "edge";

interface HomeSearchParams {
  category?: string | string[];
  source?: string | string[];
  q?: string | string[];
  hours?: string | string[];
  sort?: string | string[];
  topic?: string | string[];
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
  const urlSort = pick(sp.sort) === "importance" ? "importance" : "time";
  const urlTopic = pick(sp.topic);
  const filters: FeedFilters = {
    category: urlCategory,
    sourceId: pick(sp.source),
    q: pick(sp.q),
    hours: Number(pick(sp.hours)) || (urlSort === "importance" ? 168 : 72),
    sort: urlSort,
    topicCategory: urlTopic,
  };

  // 精选查询独立降级，单独失败时不影响下方实时信息流。
  const picksPromise = getDailyTop({ hours: 48, limit: 8, minImportance: 55 })
    .catch((err: unknown) => {
      console.error("[home] 精选读取失败，继续显示实时信息流:", err);
      return { items: [], eventSourceCounts: new Map<string, number>() };
    });

  // 数据库不可达时降级渲染空时间线（200 + 提示），而不是抛 500 把整站打成错误页——
  // 2026-09-26 Turso 读封锁期间，5 个语言的所有页面连续 5xx，收录直接受冲击。
  let page: FeedPage;
  let meta: BriefMeta;
  let degraded = false;
  try {
    [page, meta] = await Promise.all([listArticles(filters), getBriefMeta()]);
  } catch (err) {
    degraded = true;
    page = emptyFeedPage();
    meta = emptyBriefMeta();
    console.error("[home] 数据读取失败，降级渲染空时间线:", err);
  }
  const { items: picks, eventSourceCounts } = await picksPromise;
  const items = withFreshness(page.items);
  const schemaItems = [...picks, ...items]
    .filter((article, index, all) => all.findIndex((candidate) => candidate.id === article.id) === index)
    .slice(0, 30);
  // 库读不到时，退回构建时抓取的信源快照（无洞察、无多语），而不是给访客一个空白时间线
  const emergency = degraded ? emergencyItems() : [];
  const feedKey = `${urlCategory ?? ""}|${filters.sourceId ?? ""}|${filters.q ?? ""}|${filters.hours ?? ""}|${urlSort}|${urlTopic ?? ""}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: t("timeline"),
    description: ts("description"),
    url: `https://aihot.cataito.com/${locale}`,
    inLanguage: locale,
    // 降级时不输出空 ItemList：给爬虫一个空列表比不给更糟
    ...(degraded
      ? {}
      : {
          mainEntity: {
            "@type": "ItemList",
            itemListElement: schemaItems.map((a, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: pickTitle(a, locale).primary,
              url: a.url,
            })),
          },
        }),
  };
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: locale === "zh" ? "AI 热点简报" : "AI Hot Takes",
    url: "https://aihot.cataito.com",
    sameAs: ["https://github.com/cataito-lab/aihot"],
    contactPoint: {
      "@type": "ContactPoint",
      email: "hello@cataito.com",
      contactType: "customer support",
    },
    address: {
      "@type": "PostalAddress",
      addressCountry: "CN",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
      />
      <Header activeCategory={urlCategory} q={filters.q} activeTopic={urlTopic} sourcesCount={meta.sourcesEnabled} />
      <main className="site-main home-main">
        {degraded && <DegradedNote />}
        <BriefingPanel meta={meta} />

        {picks.length > 0 && (
          <section className="home-editorial v2-section" aria-labelledby="home-picks-title">
            <div className="v2-section-head">
              <div>
                <h2 id="home-picks-title">{t("picksTitle")}</h2>
                <span>{t("picksSubtitle")}</span>
              </div>
            </div>
            <div className="v2-picks">
              {picks.map((article, index) => (
                <PickCard
                  key={article.id}
                  article={article}
                  locale={locale}
                  rank={index + 1}
                  eventSources={article.eventId ? eventSourceCounts.get(article.eventId) : undefined}
                />
              ))}
            </div>
          </section>
        )}

        {(filters.q || filters.sourceId || filters.category || filters.topicCategory) && (
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
            {filters.topicCategory && (
              <span className="px-2.5 py-0.5 rounded-md bg-neon-soft text-accent font-mono text-[11px]">
                TOPIC={filters.topicCategory}
              </span>
            )}
          </div>
        )}

        {degraded && emergency.length > 0 ? (
          <section aria-labelledby="home-stream-title">
            <div className="home-stream-heading">
              <h2 id="home-stream-title">{t("streamTitle")}</h2>
              <p>{t("streamSubtitle")}</p>
            </div>
            <EmergencyFeedList items={emergency} locale={locale} />
          </section>
        ) : (
          <section className="animate-fade-up" aria-labelledby="home-stream-title">
            <div className="home-stream-heading">
              <h2 id="home-stream-title">{t("streamTitle")}</h2>
              <p>{t("streamSubtitle")}</p>
            </div>
            <NewsFeed
              key={feedKey}
              initialItems={items}
              initialCursor={page.nextCursor}
              filters={filters}
            />
          </section>
        )}
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
