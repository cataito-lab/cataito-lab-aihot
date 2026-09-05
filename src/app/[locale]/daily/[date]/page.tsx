import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Header } from "@/components/header";
import { DailyDateNav } from "@/components/daily-date-nav";
import { TzNote } from "@/components/tz-note";
import { ArticleItem } from "@/components/article-item";
import { getDailyArticles, getDailyDates } from "@/lib/news";
import { pickTitle } from "@/lib/i18n";
import type { FeedArticle } from "@/lib/types";

export const runtime = "edge";

const SITE_URL = "https://aihot.cataito.com";
const LOCALES = ["en", "zh", "ja", "es", "fr"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface Props {
  params: Promise<{ locale: string; date: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, date } = await params;
  if (!DATE_RE.test(date)) return {};
  const t = await getTranslations({ locale, namespace: "daily" });
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, `${SITE_URL}/${l}/daily/${date}`]),
  );
  return {
    title: `${t("title")} · ${date}`,
    description: `${t("description")} ${date}`,
    alternates: {
      canonical: `/${locale}/daily/${date}`,
      languages: { ...languages, "x-default": `${SITE_URL}/en/daily/${date}` },
    },
    openGraph: {
      title: `${t("title")} · ${date}`,
      description: t("description"),
      url: `${SITE_URL}/${locale}/daily/${date}`,
      type: "website",
    },
  };
}

export default async function DailyPage({ params }: Props) {
  const { locale, date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const t = await getTranslations("daily");
  const ta = await getTranslations("article");
  const items: FeedArticle[] = await getDailyArticles(date);
  const dates = await getDailyDates(30);

  const catLabel = (cat: string): string =>
    cat === "official"
      ? ta("catOfficial")
      : cat === "community"
        ? ta("catCommunity")
        : ta("catMedia");

  const byCategory = new Map<string, number>();
  for (const a of items) {
    byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + 1);
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${t("title")} · ${date}`,
    url: `${SITE_URL}/${locale}/daily/${date}`,
    inLanguage: locale,
    datePublished: `${date}T00:00:00.000Z`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.slice(0, 50).map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: pickTitle(a, locale).primary,
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
      <Header />
      <main className="site-main">
        <section className="animate-fade-up">
          <h1 className="text-2xl font-bold">
            {t("title")} <span className="font-mono">{date}</span>
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="px-2.5 py-0.5 rounded-md bg-neon-soft text-accent">
              {t("itemsCount", { n: items.length })}
            </span>
            {[...byCategory.entries()].map(([cat, n]) => (
              <span key={cat} className="px-2.5 py-0.5 rounded-md bg-neon-soft text-fg-muted">
                {catLabel(cat)} {n}
              </span>
            ))}
          </div>
          <div className="mt-4">
            <DailyDateNav dates={dates} current={date} />
          </div>
        </section>

        <section className="mt-8">
          {items.length === 0 ? (
            <p className="py-24 text-center text-fg-muted">{t("noData")}</p>
          ) : (
            <ol className="relative ml-0 flex flex-col gap-5">
              {items.map((a, i) => (
                <ArticleItem key={a.id} article={a} index={i} />
              ))}
            </ol>
          )}
        </section>
      </main>
      <footer className="pb-10 pt-6 border-t border-line/60">
        <TzNote />
      </footer>
    </>
  );
}
