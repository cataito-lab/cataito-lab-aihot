import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/header";
import { DailyDateNav } from "@/components/daily-date-nav";
import { TzNote } from "@/components/tz-note";
import { getDailyDates } from "@/lib/news";

export const runtime = "edge";

const SITE_URL = "https://aihot.cataito.com";
const LOCALES = ["en", "zh", "ja", "es", "fr"] as const;

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "daily" });
  const languages = Object.fromEntries(
    LOCALES.map((l) => [l, `${SITE_URL}/${l}/daily`]),
  );
  return {
    title: t("archive"),
    description: t("description"),
    alternates: {
      canonical: `/${locale}/daily`,
      languages: { ...languages, "x-default": `${SITE_URL}/en/daily` },
    },
  };
}

export default async function DailyIndexPage({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations("daily");
  const dates = await getDailyDates(30);

  return (
    <>
      <Header />
      <main className="site-main">
        <section className="animate-fade-up">
          <span className="signal-tag">{t("tag")}</span>
          <h1 className="text-2xl font-bold mt-2">{t("archive")}</h1>
          <p className="mt-2 text-fg-muted text-sm">{t("description")}</p>
          <div className="mt-4">
            <DailyDateNav latest={dates[0]?.date} />
          </div>
        </section>

        <section className="mt-8">
          <ul className="flex flex-col gap-2">
            {dates.map((d) => (
              <li key={d.date}>
                <a
                  href={`/${locale}/daily/${d.date}`}
                  className="card flex items-center justify-between py-3 px-4 hover:border-accent"
                >
                  <span className="font-mono text-sm text-fg">{d.date}</span>
                  <span className="font-mono text-[11px] text-fg-muted">
                    {t("itemsCount", { n: d.count })}
                  </span>
                </a>
              </li>
            ))}
            {dates.length === 0 && (
              <li className="py-16 text-center text-fg-muted">{t("noData")}</li>
            )}
          </ul>
        </section>
      </main>
      <footer className="pb-10 pt-6 border-t border-line/60">
        <TzNote />
      </footer>
    </>
  );
}
