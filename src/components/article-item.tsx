"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Star, CaretDown, CaretUp, Lightning, ArrowSquareOut } from "@phosphor-icons/react";
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

function fmtSaved(iso: string | undefined, locale: string, t: ReturnType<typeof useTranslations<"article">>, sourceTimezone?: string, estimated?: boolean): string {
  if (!iso) return "";
  return fmtTime(iso, locale, t, sourceTimezone, estimated);
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
      className="animate-fade-up group relative rounded-xl border border-line bg-surface transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-accent/40 hover:bg-surface/95 hover:-translate-y-[1px] hover:shadow-[0_10px_30px_-12px_rgba(0,0,0,0.4)]"
      style={{ animationDelay: `${Math.min(index * 28, 320)}ms` }}
    >
      <div className="px-5 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-2 text-[11px] font-mono text-fg-muted">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${t("verify")}: ${article.sourceName}`}
            className="text-[12px] font-semibold text-fg uppercase tracking-[0.06em] hover:text-neon transition-colors"
          >
            [{article.sourceName}]
          </a>
          <span aria-hidden className="text-fg-muted/70">·</span>
          <span>
            {timeLabel}{" "}<time dateTime={article.publishedAt} className="font-mono text-fg-secondary" suppressHydrationWarning>{fmtTime(article.publishedAt, locale, t, article.sourceTimezone, article.estimated)}</time>
          </span>
          <span className="flex-1" />
          {isNew && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neon-soft text-neon font-mono text-[10px] font-semibold border border-neon/20">
              <Lightning size={10} weight="fill" /> NEW
            </span>
          )}
          <span className="ml-2">{catLabel(locale, article.category)}</span>
        </div>

        <h3 className="mt-2.5">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[17px] font-semibold leading-snug tracking-[-0.005em] text-fg hover:text-neon transition-colors"
          >
            {primary}
          </a>
        </h3>
        {secondary && (
          <p className="mt-0.5 text-[13px] leading-snug text-fg-muted truncate">{secondary}</p>
        )}

        {hasSummary && (
          <>
            <div
              className={`overflow-hidden transition-all duration-300 ease-out ${summaryOpen ? "grid grid-rows-[1fr] opacity-100 mt-3" : "grid grid-rows-[0fr] opacity-0 mt-0"}`}
            >
              <div className="min-h-0">
                <div className="relative rounded-lg border border-line/60 border-l-[2px] border-l-neon bg-surface/60 px-4 py-3">
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-neon mb-1 flex items-center gap-2">
                    <Lightning size={12} weight="fill" />
                    {t("aiSummary")}
                  </div>
                  <p className="text-[14px] leading-relaxed text-fg-secondary">{article.summary}</p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSummaryOpen((o) => !o)}
              className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-neon hover:text-accent-strong transition-colors cursor-pointer"
            >
              {summaryOpen ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />}
              {summaryOpen ? t("hideSummary") : t("showSummary")}
            </button>
          </>
        )}

        <div className="mt-3 flex items-center justify-between pt-3 border-t border-line/50">
          <span suppressHydrationWarning className="font-mono text-[10px] text-fg-muted">
            {t("savedAt")} {fmtSaved(article.fetchedAt ?? article.publishedAt, locale, t, article.sourceTimezone, article.estimated)}
          </span>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-fg-secondary hover:text-neon transition-colors"
          >
            {t("verify")} <ArrowSquareOut size={12} />
          </a>
          <button
            type="button"
            onClick={() => toggleFavorite(article.id)}
            aria-label={starred ? t("unstar") : t("star")}
            aria-pressed={starred}
            className={`ml-2 transition-all active:scale-75 cursor-pointer ${starred ? "text-star" : "text-fg-muted opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 hover:text-star"}`}
          >
            <Star size={15} weight={starred ? "fill" : "regular"} />
          </button>
        </div>
      </div>
    </li>
  );
}