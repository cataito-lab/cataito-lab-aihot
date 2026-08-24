"use client";

import { useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Star } from "@phosphor-icons/react";
import type { FeedArticle } from "@/lib/types";
import { isFavorite, subscribeFavorites, toggleFavorite } from "@/lib/favorites";

function useFavorite(id: string): boolean {
  return useSyncExternalStore(
    subscribeFavorites,
    () => isFavorite(id),
    () => false,
  );
}

/** 原文时区 → 用户可读标签（仅非 UTC 时显示） */
function timezoneLabel(tz: string | undefined): string {
  if (!tz || tz === "UTC") return "";
  // 用浏览器本地时区作参考年份取偏移
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  return parts.find((p) => p.type === "timeZoneName")?.value ?? tz;
}

/** 时间差（分钟），非负 */
function diffMinutes(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

/** 主时间：智能双态 —— <24h 显示相对时间，≥24h 显示绝对时间（用户本地时区）
 * 并可选附加源时区标签（如 "· CST"）与估算标记（"约 3h ago"）。 */
function fmtTime(
  iso: string,
  locale: string,
  t: ReturnType<typeof useTranslations<"article">>,
  sourceTimezone?: string,
  estimated?: boolean,
): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diffMin = diffMinutes(iso);
  const tzLabel = timezoneLabel(sourceTimezone);
  const est = estimated ? t("estimated") + " " : "";

  // <24h：相对时间
  if (diffMin < 1) return est + t("justNow");
  if (diffMin < 60) return est + t("minutesAgo", { n: diffMin });
  if (diffMin < 1440) {
    const h = Math.floor(diffMin / 60);
    return est + t("hoursAgo", { n: h });
  }
  // ≥24h：绝对时间
  const abs = d.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return tzLabel ? `${est}${abs} · ${tzLabel}` : `${est}${abs}`;
}

/** 按 locale 取摘要；缺失时回退 en → zh（zh 为主列，摘要行必有） */
function pickSummary(article: FeedArticle, locale: string): string | null {
  if (locale === "zh") return article.summary;
  if (locale === "ja") return article.summaryJa ?? article.summaryEn ?? article.summary;
  if (locale === "es") return article.summaryEs ?? article.summaryEn ?? article.summary;
  if (locale === "fr") return article.summaryFr ?? article.summaryEn ?? article.summary;
  return article.summaryEn ?? article.summary;
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
  const summary = pickSummary(article, locale);
  const hasSummary = Boolean(summary);
  const timeLabel = article.category === "community" ? t("discussion") : t("event");

  return (
    <li
      className="card animate-fade-up"
      style={{ animationDelay: `${Math.min(index * 28, 320)}ms` }}
    >
      <div className="card-meta">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`${t("verify")}: ${article.sourceName}`}
          className="source-tag"
        >
          [{article.sourceName}]
        </a>
        <span className="dot-divider" aria-hidden>·</span>
        <span className="event-time">
          {timeLabel}{" "}
          <time dateTime={article.publishedAt} suppressHydrationWarning>
            {fmtTime(article.publishedAt, locale, t, article.sourceTimezone, article.estimated)}
          </time>
        </span>
        {isNew && <span className="badge-new">NEW</span>}
      </div>

      <h3>
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          {primary}
        </a>
      </h3>
      {secondary && <p className="title-secondary">{secondary}</p>}

      {hasSummary && (
        <div className="ai-summary-box">
          <div className="ai-summary-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            {t("aiSummary")}
          </div>
          <div className="ai-summary-content">{summary}</div>
        </div>
      )}

      <div className="card-footer">
        <span suppressHydrationWarning>
          {t("savedAt")}{" "}
          {fmtTime(article.fetchedAt ?? article.publishedAt, locale, t, article.sourceTimezone, article.estimated)}
        </span>
        <span className="inline-flex items-center gap-3">
          <button
            type="button"
            onClick={() => toggleFavorite(article.id)}
            aria-label={starred ? t("unstar") : t("star")}
            aria-pressed={starred}
            className={`transition-colors cursor-pointer ${
              starred ? "text-[#10b981]" : "text-[#71717a] hover:text-[#f4f4f5]"
            }`}
          >
            <Star size={14} weight={starred ? "fill" : "regular"} />
          </button>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="original-link"
          >
            {t("verify")} ↗
          </a>
        </span>
      </div>
    </li>
  );
}
