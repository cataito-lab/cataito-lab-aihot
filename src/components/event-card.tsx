"use client";

import { useTranslations, useLocale } from "next-intl";
import { Fire, Star } from "@phosphor-icons/react";
import type { FeedArticle } from "@/lib/types";

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

export function EventCard({ items, index }: { items: FeedArticle[]; index: number }) {
  const tArticle = useTranslations("article");
  const tFeed = useTranslations("feed");
  const locale = useLocale();

  const best = [...items].sort((a, b) => (b.scoreFinal ?? -1) - (a.scoreFinal ?? -1))[0];
  const primary = best.titleZh ?? best.title;
  const secondary = best.titleZh && best.titleZh !== best.title ? best.title : null;
  const tier = tierOf(best.scoreFinal);
  const latest = items.reduce((m, i) => (i.publishedAt > m ? i.publishedAt : m), items[0].publishedAt);
  const eventSummary = items[0].eventSummary;
  const canonicalSummary = pickSummary(best, locale);

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
          <span className={`tier-badge tier-${tier}`} title={`AIHOT ${best.scoreFinal}`}>
            {tier === "major" ? (
              <Fire size={12} weight="fill" />
            ) : tier === "important" ? (
              <Star size={12} weight="fill" />
            ) : (
              <span className="tier-dot" aria-hidden />
            )}
            <span className="tier-num">{best.scoreFinal}</span>
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
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              {tArticle("aiSummary")}
            </div>
            <div className="ai-summary-content">{canonicalSummary}</div>
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
            title={it.titleZh ?? it.title}
          >
            <span className={`cat-dot ${CAT_DOT[it.category] ?? "cat-dot-community"}`} aria-hidden />
            <span className="src-name">{it.sourceName}</span>
            <span className="src-title">{it.titleZh ?? it.title}</span>
          </a>
        ))}
      </div>
    </li>
  );
}
