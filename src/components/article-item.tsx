"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Star, CaretDown } from "@phosphor-icons/react";
import type { FeedArticle } from "@/lib/types";
import { isFavorite, subscribeFavorites, toggleFavorite } from "@/lib/favorites";

function useFavorite(id: string): boolean {
  return useSyncExternalStore(
    subscribeFavorites,
    () => isFavorite(id),
    () => false,
  );
}

function fmtClock(iso: string, locale: string, t: ReturnType<typeof useTranslations<"article">>): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMin >= 0 && diffMin < 1) return t("justNow");
  if (diffMin > 0 && diffMin < 60) return t("minutesAgo", { n: diffMin });
  const sameDay = d.toDateString() === now.toDateString();
  const hm = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  if (sameDay) return hm;
  const yesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
  if (yesterday) return `${t("yesterday")} ${hm}`;
  return `${d.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" })} ${hm}`;
}

function catLabel(locale: string, id: string): string {
  const map: Record<string, string> = {
    official: "official",
    "media-cn": locale === "zh" ? "中文媒体" : "CN Media",
    "media-en": locale === "zh" ? "英文媒体" : "EN Media",
    community: locale === "zh" ? "社区" : "Community",
  };
  return map[id] ?? id;
}

export function ArticleItem({
  article,
  index,
}: {
  article: FeedArticle;
  index: number;
}) {
  const t = useTranslations("article");
  const locale = useLocale();
  const starred = useFavorite(article.id);
  const [summaryOpen, setSummaryOpen] = useState(false);

  let primary: string;
  let secondary: string | null;
  if (locale === "zh") {
    primary = article.titleZh ?? article.title;
    secondary = article.titleZh ? article.title : null;
  } else {
    primary = article.title;
    secondary = null;
  }

  const isNew = article.isNew === true;
  const hasSummary = Boolean(article.summary);
  const timeLabel = article.category === "community" ? t("discussion") : t("event");

  return (
    <li
      className="animate-fade-up group relative pl-6 sm:pl-7"
      style={{ animationDelay: `${Math.min(index * 28, 320)}ms` }}
    >
      <span aria-hidden className={`absolute left-[5px] top-[9px] w-[7px] h-[7px] rounded-full transition-colors ${isNew ? "bg-neon neon-glow" : "bg-line group-hover:bg-accent/60"}`} />
      <div className="hud-host relative rounded-xl px-4 py-3.5 -mx-1 transition-colors duration-200 hover:bg-surface/80">
        <i className="hud-tl" aria-hidden />
        <i className="hud-tr" aria-hidden />
        <i className="hud-bl" aria-hidden />
        <i className="hud-br" aria-hidden />

        <div className="flex items-center gap-2 text-[11px] font-mono text-fg-muted">
          <a href={article.url} target="_blank" rel="noopener noreferrer" title={`${t("verify")}: ${article.sourceName}`} className="uppercase tracking-[0.08em] text-fg-secondary hover:text-neon transition-colors">
            [{article.sourceName}]
          </a>
          <span aria-hidden>·</span>
          <span>
            {timeLabel}{" "}
            <time dateTime={article.publishedAt} suppressHydrationWarning>{fmtClock(article.publishedAt, locale, t)}</time>
          </span>
          {isNew && (
            <>
              <span aria-hidden>·</span>
              <span className="text-neon text-glow-neon">NEW</span>
            </>
          )}
          <span className="flex-1" />
          <span>{catLabel(locale, article.category)}</span>
        </div>

        <h3 className="mt-1.5">
          <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-[17px] font-bold leading-snug tracking-[-0.01em] text-fg hover:text-neon transition-colors">
            {primary}
          </a>
        </h3>
        {secondary && (
          <p className="mt-0.5 text-[13px] leading-snug text-fg-muted truncate">{secondary}</p>
        )}

        {hasSummary && (
          <>
            <div className={`grid transition-all duration-300 ease-out ${summaryOpen ? "grid-rows-[1fr] opacity-100 mt-2.5" : "grid-rows-[0fr] opacity-0 mt-0"}`}>
              <div className="overflow-hidden">
                <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted mb-1">{t("aiSummary")}</p>
                <p className="text-[14px] leading-relaxed text-fg-secondary">{article.summary}</p>
              </div>
            </div>
            {!summaryOpen && (
              <button type="button" onClick={() => setSummaryOpen(true)} className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-neon hover:text-accent-strong transition-colors cursor-pointer">
                {t("showSummary")}
                <CaretDown size={10} weight="bold" />
              </button>
            )}
          </>
        )}

        <div className="mt-2 flex items-center gap-3">
          <span suppressHydrationWarning className="font-mono text-[11px] text-fg-muted/70">
            {t("savedAt")} {fmtClock(article.fetchedAt ?? article.publishedAt, locale, t)}
          </span>
          {hasSummary && summaryOpen && (
            <button type="button" onClick={() => setSummaryOpen(false)} className="font-mono text-[11px] text-fg-muted hover:text-fg-secondary transition-colors cursor-pointer">
              {t("hideSummary")}
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => toggleFavorite(article.id)}
            aria-label={starred ? t("unstar") : t("star")}
            aria-pressed={starred}
            className={`transition-all active:scale-75 cursor-pointer ${starred ? "text-star" : "text-fg-muted opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 hover:text-star"}`}
          >
            <Star size={15} weight={starred ? "fill" : "regular"} />
          </button>
        </div>
      </div>
    </li>
  );
}