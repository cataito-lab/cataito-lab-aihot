import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/header";
import { getEvent } from "@/lib/news";
import type { EventMember } from "@/lib/types";
import { pickTitle } from "@/lib/i18n";
import { pickField, pickSummary } from "@/lib/localize";

const SITE_URL = "https://aihot.cataito.com";

export const runtime = "edge";

function tierOf(score: number | null): "major" | "important" | "normal" | null {
  if (score == null) return null;
  if (score >= 80) return "major";
  if (score >= 65) return "important";
  return "normal";
}

function fmt(d: string, locale: string): string {
  return new Date(d).toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}): Promise<Metadata> {
  const { locale, key } = await params;
  const t = await getTranslations({ locale, namespace: "event" });
  const event = await getEvent(key);
  if (!event) return { title: t("notFoundTitle") };
  const title = pickTitle(event, locale).primary || "AI 事件";
  const raw = locale === "zh" ? event.summary : locale === "en" ? event.summaryEn : null;
  const description = raw ? (raw.length > 160 ? `${raw.slice(0, 157)}…` : raw) : title;
  const path = `/${locale}/event/${event.eventKey}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${path}`,
      type: "article",
      siteName: "AI 热点简报",
      locale,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

  function TierBadge({ score }: { score: number | null }) {
    const tier = tierOf(score);
    if (!tier) return null;
    return (
      <span className={`tier-badge tier-${tier}`} title={`AIHOT ${score}`}>
        {tier === "major" ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M13 2c1.5 3.5-1.5 5-1.5 7.5 0 1.2 1 2.2 2.2 2.2 2.4 0 3.6-2.4 3.6-4.8 2.4 2.4 3.7 5.6 3.7 7.9a6.5 6.5 0 1 1-13 0C8.5 12 10.5 9.8 12 7c0-2 1-3.2 1-5z" />
          </svg>
        ) : tier === "important" ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M13 2c1.5 3.5-1.5 5-1.5 7.5 0 1.2 1 2.2 2.2 2.2 2.4 0 3.6-2.4 3.6-4.8 2.4 2.4 3.7 5.6 3.7 7.9a6.5 6.5 0 1 1-13 0C8.5 12 10.5 9.8 12 7c0-2 1-3.2 1-5z" />
          </svg>
        ) : (
          <span className="tier-dot" aria-hidden />
        )}
        <span className="tier-num">{score}</span>
        <span className="tier-label">AIHOT</span>
      </span>
    );
  }

function MemberCard({ m, locale, verifyLabel }: {
  m: EventMember;
  locale: string;
  verifyLabel: string;
}) {
  const summary = pickSummary(m, locale);
  return (
    <li className="card event-member">
      <div className="card-meta">
        <span className="src-chip">
          <span className={`cat-dot cat-dot-${m.category}`} aria-hidden />
          {m.sourceName}
        </span>
        <TierBadge score={m.scoreFinal} />
        <span className="meta-sep" aria-hidden>|</span>
        <span className="meta-time">
          <time dateTime={m.publishedAt}>{fmt(m.publishedAt, locale)}</time>
        </span>
      </div>
      <h3>
        <a href={m.url} target="_blank" rel="noopener noreferrer">
          {pickTitle(m, locale).primary}
        </a>
      </h3>
      {summary && <p className="member-summary">{summary}</p>}
      {(() => {
        const kc = pickField(
          { zh: m.keyChange, en: m.keyChangeEn, ja: m.keyChangeJa, es: m.keyChangeEs, fr: m.keyChangeFr },
          locale,
        );
        const fs = pickField(
          { zh: m.forwardSignal, en: m.forwardSignalEn, ja: m.forwardSignalJa, es: m.forwardSignalEs, fr: m.forwardSignalFr },
          locale,
        );
        if (!kc && !fs) return null;
        return (
          <div className="ai-insight-mini">
            {kc && <span className="ai-mini-change">{kc}</span>}
            {fs && <span className="ai-mini-fwd">{fs}</span>}
          </div>
        );
      })()}
      <a className="verify-link" href={m.url} target="_blank" rel="noopener noreferrer">
        {verifyLabel} →
      </a>
    </li>
  );
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; key: string }>;
}) {
  const { locale, key } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("event");
  const tArticle = await getTranslations("article");
  const event = await getEvent(key);

  if (!event) {
    return (
      <>
        <Header />
        <main className="site-main">
          <div className="event-detail card">
            <h1>{t("notFoundTitle")}</h1>
            <p className="member-summary">{t("notFoundHint")}</p>
            <Link href="/" className="event-back">{t("backHome")}</Link>
          </div>
        </main>
      </>
    );
  }

  const { primary, secondary } = pickTitle(event, locale);
  const summary = locale === "zh" ? event.summary : locale === "en" ? event.summaryEn : null;

  const progression = [...event.members].sort(
    (a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime(),
  );
  const steps = progression
    .map((m) => ({
      m,
      kc: pickField(
        { zh: m.keyChange, en: m.keyChangeEn, ja: m.keyChangeJa, es: m.keyChangeEs, fr: m.keyChangeFr },
        locale,
      ),
    }))
    .filter((x) => x.kc) as Array<{ m: EventMember; kc: string }>;
  const nextSignal = (() => {
    const desc = [...event.members].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
    for (const m of desc) {
      const v = pickField(
        { zh: m.forwardSignal, en: m.forwardSignalEn, ja: m.forwardSignalJa, es: m.forwardSignalEs, fr: m.forwardSignalFr },
        locale,
      );
      if (v) return v;
    }
    return null;
  })();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsEvent",
    name: primary,
    description: summary ?? "",
    url: `${SITE_URL}/${locale}/event/${event.eventKey}`,
    inLanguage: locale,
    aggregator: { "@type": "Organization", name: "AI 热点简报" },
    subjectOf: event.members.map((m) => ({
      "@type": "NewsArticle",
      headline: pickTitle(m, locale).primary,
      url: m.url,
      datePublished: m.publishedAt,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main className="site-main">
        <Link href="/" className="event-back">{t("back")}</Link>

        <article className="event-detail card">
          <div className="card-meta">
            <span className="src-chip event-chip">
              <span className="cat-dot cat-dot-event" aria-hidden />
              {t("overview")}
            </span>
            <TierBadge score={event.peakScore} />
            <span className="meta-sep" aria-hidden>|</span>
            <span className="meta-time">
              {t("firstSeen")} <time dateTime={event.firstSeen}>{fmt(event.firstSeen, locale)}</time>
              {" · "}
              {t("lastSeen")} <time dateTime={event.lastSeen}>{fmt(event.lastSeen, locale)}</time>
            </span>
          </div>

          <h1>{primary}</h1>
          {secondary && <p className="title-secondary">{secondary}</p>}

          {summary ? (
            <div className="ai-summary-box">
              <div className="ai-summary-title">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
                </svg>
                {t("synthesis")}
              </div>
              <div className="ai-summary-content">{summary}</div>
            </div>
           ) : null}

           {steps.length > 0 && (
             <div className="event-progression">
               <div className="event-sources-head">{t("progression")}</div>
               <ol className="timeline-cards">
                 {steps.map(({ m, kc }) => (
                   <li key={m.id} className="card event-member event-step">
                     <div className="card-meta">
                       <span className="src-chip">
                         <span className={`cat-dot cat-dot-${m.category}`} aria-hidden />
                         {m.sourceName}
                       </span>
                       <span className="meta-sep" aria-hidden>|</span>
                       <span className="meta-time">
                         <time dateTime={m.publishedAt}>{fmt(m.publishedAt, locale)}</time>
                       </span>
                     </div>
                     <div className="ai-mini-change">{kc}</div>
                   </li>
                 ))}
               </ol>
             </div>
           )}

           {nextSignal && (
             <div className="ai-summary-box event-next">
               <div className="ai-summary-title">
                 <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                   <circle cx="12" cy="12" r="9" />
                   <path d="M12 8v5l3 2" />
                 </svg>
                 {t("nextSignal")}
               </div>
               <div className="ai-summary-content">{nextSignal}</div>
             </div>
           )}

           <div className="event-members">
            <div className="event-sources-head">
              {t("sources")} · {event.sourceCount}
            </div>
            <ol className="timeline-cards">
              {event.members.map((m) => (
                <MemberCard key={m.id} m={m} locale={locale} verifyLabel={tArticle("verify")} />
              ))}
            </ol>
          </div>
        </article>
      </main>
      <footer className="pb-10 pt-6 border-t border-line/60">
        <p className="text-center text-xs text-fg-muted">
          <span className="font-semibold text-fg">{t("backHome")}</span>
        </p>
      </footer>
    </>
  );
}
