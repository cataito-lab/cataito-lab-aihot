"use client";

import { useTranslations, useLocale } from "next-intl";
import { Fire } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import type { FeedArticle } from "@/lib/types";
import { pickTitle } from "@/lib/i18n";

const CAT_DOT: Record<string, string> = {
  official: "cat-dot-official",
  "media-cn": "cat-dot-media",
  "media-en": "cat-dot-media",
  community: "cat-dot-community",
};

function tierOf(score: number | null): "major" | "important" | "normal" | null {
  if (score == null) return null;
  if (score >= 80) return "major";
  if (score >= 65) return "important";
  return "normal";
}

function pickSummary(a: FeedArticle, locale: string): string | null {
  if (locale === "zh") return a.summary;
  if (locale === "ja") return a.summaryJa ?? a.summaryEn;
  if (locale === "es") return a.summaryEs ?? a.summaryEn;
  if (locale === "fr") return a.summaryFr ?? a.summaryEn;
  return a.summaryEn;
}

function pickField(
  v: {
    zh: string | null;
    en: string | null;
    ja: string | null;
    es: string | null;
    fr: string | null;
  },
  locale: string,
): string | null {
  if (locale === "zh") return v.zh ?? v.en;
  if (locale === "en") return v.en ?? v.zh;
  if (locale === "ja") return v.ja ?? v.en ?? v.zh;
  if (locale === "es") return v.es ?? v.en ?? v.zh;
  if (locale === "fr") return v.fr ?? v.en ?? v.zh;
  return v.en ?? v.zh;
}

export function EventCard({
  items,
  index,
  eventKey,
}: {
  items: FeedArticle[];
  index: number;
  eventKey?: string | null;
}) {
  const tArticle = useTranslations("article");
  const tFeed = useTranslations("feed");
  const locale = useLocale();

  const best = [...items].sort((a, b) => (b.scoreFinal ?? -1) - (a.scoreFinal ?? -1))[0];
  const { primary, secondary } = pickTitle(best, locale);
  const tier = tierOf(best.scoreFinal);
  const latest = items.reduce((m, i) => (i.publishedAt > m ? i.publishedAt : m), items[0].publishedAt);
  const eventSummary = items[0].eventSummary;
  const canonicalSummary = pickSummary(best, locale);
  const kc = pickField(
    { zh: best.keyChange, en: best.keyChangeEn, ja: best.keyChangeJa, es: best.keyChangeEs, fr: best.keyChangeFr },
    locale,
  );
  const fs = pickField(
    { zh: best.forwardSignal, en: best.forwardSignalEn, ja: best.forwardSignalJa, es: best.forwardSignalEs, fr: best.forwardSignalFr },
    locale,
  );

  return (
    <li
      className="card event-card animate-fade-up"
      style={{ animationDelay: `${Math.min(index * 28, 320)}ms` }}
    >
      <div className="card-meta">
        <span className="src-chip event-chip">
          <span className="cat-dot cat-dot-event" aria-hidden />
          {tFeed("eventSources", { n: items.length })}
        </span>
        {tier && (
          <span className={`tier-badge tier-${tier}`} title={`${tArticle("aihot")} ${best.scoreFinal}`}>
            {tier === "major" ? (
              <Fire size={12} weight="fill" />
            ) : tier === "important" ? (
              <Fire size={12} weight="fill" />
            ) : (
              <span className="tier-dot" aria-hidden />
            )}
            <span className="tier-num">{best.scoreFinal}</span>
            <span className="tier-label">{tArticle("aihot")}</span>
          </span>
        )}
        <span className="meta-sep" aria-hidden>|</span>
        <span className="meta-time">
          <time dateTime={latest}>
            {new Date(latest).toLocaleString(locale, {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </time>
        </span>
      </div>

      <h2>
        <a href={best.url} target="_blank" rel="noopener noreferrer">
          {primary}
        </a>
      </h2>
      {secondary && <p className="title-secondary">{secondary}</p>}

      {eventSummary ? (
        <div className="ai-summary-box">
          <div className="ai-summary-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
            </svg>
            {tFeed("eventSynthesis")}
          </div>
          <div className="ai-summary-content">{eventSummary}</div>
        </div>
      ) : (
        canonicalSummary && (
          <div className="ai-summary-box">
            <div className="ai-summary-title">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
              </svg>
              {tArticle("aiSummary")}
            </div>
            <div className="ai-summary-content">{canonicalSummary}</div>
          {(kc || fs || best.importanceScore != null) && (
            <div className="ai-insight-mini">
              {kc && <span className="ai-mini-change">{kc}</span>}
              {fs && <span className="ai-mini-fwd">{fs}</span>}
              {best.importanceScore != null && (
                <span className="ai-mini-imp">{tArticle("importance")} {best.importanceScore}</span>
              )}
            </div>
          )}
          </div>
        )
      )}

      <div className="event-sources">
        <div className="event-sources-head">{tFeed("sourcesLabel")}</div>
        {items.map((it) => (
          <a
            key={it.id}
            className="src-line"
            href={it.url}
            target="_blank"
            rel="noopener noreferrer"
            title={pickTitle(it, locale).primary}
          >
            <span className={`cat-dot ${CAT_DOT[it.category] ?? "cat-dot-community"}`} aria-hidden />
            <span className="src-name">{it.sourceName}</span>
            <span className="src-title">{pickTitle(it, locale).primary}</span>
          </a>
        ))}
      </div>

      {eventKey && (
        <Link href={`/event/${eventKey}`} className="event-more">
          {tFeed("viewEvent")} →
        </Link>
      )}
    </li>
  );
}
