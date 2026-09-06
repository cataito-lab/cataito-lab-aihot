import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PickCard } from "@/components/v2/pick-card";
import { V2Stream } from "@/components/v2/v2-stream";
import { getDailyTop, getStreamLite } from "@/lib/news-v2";
import { getBriefMeta } from "@/lib/news";
import { formatDateTime, formatNumber } from "@/lib/format";

export const runtime = "edge";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("v2");
  // 原型页：不进索引、不进 sitemap
  return {
    title: t("badge"),
    robots: { index: false, follow: false },
  };
}

export default async function V2Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const [top, stream, meta, tV2, tBriefing] = await Promise.all([
    getDailyTop({ hours: 48, limit: 16 }),
    getStreamLite(undefined, 40, 168),
    getBriefMeta(),
    getTranslations("v2"),
    getTranslations("briefing"),
  ]);

  return (
    <main className="v2-main">
      <section className="v2-hero">
        <h1>{tV2("heroTitle")}</h1>
        <span className="v2-hero-meta">
          {tBriefing("updated")}{" "}
          {meta.updatedAt ? formatDateTime(meta.updatedAt, locale) : "—"} ·{" "}
          <b>{formatNumber(meta.last24h, locale)}</b> {tBriefing("last24h")} ·{" "}
          <b>{formatNumber(meta.sourcesEnabled, locale)}</b> {tBriefing("sources")}
        </span>
      </section>

      <section className="v2-section">
        <div className="v2-section-head">
          <h2>{tV2("picksTitle")}</h2>
          <span>{tV2("picksSubtitle")}</span>
        </div>
        {top.items.length === 0 ? (
          <div className="v2-empty">{tV2("picksEmpty")}</div>
        ) : (
          <div className="v2-picks">
            {top.items.map((article, i) => (
              <PickCard
                key={article.id}
                article={article}
                locale={locale}
                rank={i + 1}
                eventSources={
                  article.eventId
                    ? top.eventSourceCounts.get(article.eventId)
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <section className="v2-section">
        <div className="v2-section-head">
          <h2>{tV2("streamTitle")}</h2>
          <span>{tV2("streamSubtitle")}</span>
        </div>
        <V2Stream initialItems={stream.items} initialCursor={stream.nextCursor} />
      </section>
    </main>
  );
}
