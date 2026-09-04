"use client";

import { useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Fire, BookmarkSimple } from "@phosphor-icons/react";
import type { FeedArticle } from "@/lib/types";
import { isFavorite, subscribeFavorites, toggleFavorite } from "@/lib/favorites";
import {
  isInsightExpanded,
  setInsightExpanded,
  subscribeInsightPref,
} from "@/lib/insight-pref";
import { useMounted } from "@/lib/use-mounted";
import { pickTitle } from "@/lib/i18n";
import { pickField, pickSummary, pickImpact, pickTags } from "@/lib/localize";

// Phase 3c direction 4 值 → CSS class suffix + i18n message key
const IMPACT_DIRECTION_KEYS: Record<string, { cls: "beneficiary" | "atRisk" | "watching" | "neutral"; msg: "beneficiary" | "atRisk" | "watching" | "neutral" }> = {
  潜在受益: { cls: "beneficiary", msg: "beneficiary" },
  潜在承压: { cls: "atRisk", msg: "atRisk" },
  值得关注: { cls: "watching", msg: "watching" },
  中性: { cls: "neutral", msg: "neutral" },
};

function directionClass(dir: string): "beneficiary" | "atRisk" | "watching" | "neutral" {
  return IMPACT_DIRECTION_KEYS[dir]?.cls ?? "neutral";
}

function directionLabel(
  t: (key: "impactDirection.beneficiary" | "impactDirection.atRisk" | "impactDirection.watching" | "impactDirection.neutral") => string,
  dir: string,
): string {
  const entry = IMPACT_DIRECTION_KEYS[dir];
  if (!entry) return "";
  try {
    return t(`impactDirection.${entry.msg}` as const);
  } catch {
    return "";
  }
}

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

/** 悬停提示用：带年份的完整本地时间 */
function absFull(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 分类 → 色点样式 + 本地化短标签（A+C 方案） */
const CAT_META: Record<string, { dot: string; labelKey: "catOfficial" | "catMedia" | "catCommunity" }> = {
  official: { dot: "cat-dot-official", labelKey: "catOfficial" },
  "media-cn": { dot: "cat-dot-media", labelKey: "catMedia" },
  "media-en": { dot: "cat-dot-media", labelKey: "catMedia" },
  community: { dot: "cat-dot-community", labelKey: "catCommunity" },
};

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
  const mounted = useMounted();
  const insightExpanded = useSyncExternalStore(
    subscribeInsightPref,
    isInsightExpanded,
    () => false,
  );

  const { primary, secondary } = pickTitle(article, locale);

  const cat = CAT_META[article.category] ?? CAT_META.community;
  // AIHOT 重要性分级（数据已在管线计算并随 FeedArticle 下发，此处仅 surfacing）：
  // ≥80 重磅 / 65–79 重要 / 60–64 或 null 常规
  const tier = article.scoreFinal == null ? null
    : article.scoreFinal >= 80 ? "major"
    : article.scoreFinal >= 65 ? "important"
    : "normal";
  const summary = pickSummary(article, locale);
  const keyChange = pickField(
    { zh: article.keyChange, en: article.keyChangeEn, ja: article.keyChangeJa, es: article.keyChangeEs, fr: article.keyChangeFr },
    locale,
  );
  const whyItMatters = pickField(
    { zh: article.whyItMatters, en: article.whyItMattersEn, ja: article.whyItMattersJa, es: article.whyItMattersEs, fr: article.whyItMattersFr },
    locale,
  );
  const forwardSignal = pickField(
    { zh: article.forwardSignal, en: article.forwardSignalEn, ja: article.forwardSignalJa, es: article.forwardSignalEs, fr: article.forwardSignalFr },
    locale,
  );
  const impact = pickImpact(
    { zh: article.impact, en: article.impactEn, ja: article.impactJa, es: article.impactEs, fr: article.impactFr },
    locale,
  );
  const tags = pickTags(article.aiCategory, article.aiCategoryEn, locale);
  const hasAny = Boolean(
    summary || keyChange || whyItMatters || impact || forwardSignal,
  );
  // 摘要之外的可折叠洞察板块；无任何板块时不渲染展开开关
  const hasDetails = Boolean(
    keyChange ||
      whyItMatters ||
      impact ||
      forwardSignal ||
      tags ||
      article.importanceScore != null ||
      (article.entities && article.entities.length > 0),
  );

  // Title-only 源（Hacker News / Reddit / Twitter / Google News 等）没有 AI 洞察。
  // 不再渲染 fallback（"源名：标题"复读）与 "translating" 伪进度框（2026-09-05，
  // 修订 TECH_SPEC §19 的展示决策）：诚实地只显示标题与信源，等待真实洞察。

  return (
    <li
      className="card animate-fade-up"
      style={{ animationDelay: "0ms" }}
    >
      <div className="card-meta">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          title={`${t("verify")}: ${article.sourceName}`}
          className="src-chip"
        >
          <span className={`cat-dot ${cat.dot}`} aria-hidden />
          {article.sourceName}
        </a>
        <span className="meta-type">{t(cat.labelKey)}</span>
        {tier && (
          <span className={`tier-badge tier-${tier}`} title={`${t("aihot")} ${article.scoreFinal}`}>
            {tier === "major" ? (
              <Fire size={12} weight="fill" />
            ) : tier === "important" ? (
              <Fire size={12} weight="fill" />
            ) : (
              <span className="tier-dot" aria-hidden />
            )}
            <span className="tier-num">{article.scoreFinal}</span>
            <span className="tier-label">{t("aihot")}</span>
          </span>
        )}
        <span className="meta-sep" aria-hidden>|</span>
        <span className="meta-time">
          <time
            dateTime={article.publishedAt}
            title={
              mounted
                ? `${t("publishedAt")} ${absFull(article.publishedAt, locale)}${
                    article.fetchedAt ? `\n${t("savedAt")} ${absFull(article.fetchedAt, locale)}` : ""
                  }`
                : undefined
            }
          >
            {mounted
              ? fmtTime(article.publishedAt, locale, t, article.sourceTimezone, article.estimated)
              : ""}
          </time>
        </span>
        <button
          type="button"
          onClick={() => toggleFavorite(article.id)}
          aria-label={starred ? t("unstar") : t("star")}
          aria-pressed={starred}
          className={`star-btn ${starred ? "starred" : ""}`}
        >
          <BookmarkSimple size={16} weight={starred ? "fill" : "regular"} />
        </button>
      </div>

      <h2>
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          {primary}
        </a>
      </h2>
      {secondary && <p className="title-secondary">{secondary}</p>}

      {hasAny ? (
        <div className="ai-summary-box">
          <div className="ai-summary-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
            </svg>
            {t("aiSummary")}
            {hasDetails && (
              <button
                type="button"
                className="ai-details-toggle"
                aria-expanded={insightExpanded}
                onClick={() => setInsightExpanded(!insightExpanded)}
              >
                {insightExpanded ? t("insightCollapse") : t("insightExpand")}
                <svg
                  className={`chev ${insightExpanded ? "open" : ""}`}
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            )}
          </div>
          {summary && <div className="ai-summary-content">{summary}</div>}
          <div className="ai-insight-details" hidden={!insightExpanded}>
          {keyChange && (
            <div className="ai-insight-block">
              <div className="ai-insight-head">
                <svg className="ai-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="6" />
                  <circle cx="12" cy="12" r="2" />
                </svg>
                <span className="ai-insight-label">{t("insightKeyChange")}</span>
              </div>
              <div className="ai-insight-body">{keyChange}</div>
            </div>
          )}
          {whyItMatters && (
            <div className="ai-insight-block">
              <div className="ai-insight-head">
                <svg className="ai-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z" />
                  <path d="M9 21h6" />
                </svg>
                <span className="ai-insight-label">{t("insightWhy")}</span>
              </div>
              <div className="ai-insight-body">{whyItMatters}</div>
            </div>
          )}
          {impact && (
            <div className="ai-insight-block">
              <div className="ai-insight-head">
                <svg className="ai-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span className="ai-insight-label">{t("insightImpact")}</span>
              </div>
              <ul className="ai-impact">
                {impact.map((x, i) => (
                  <li key={i}>
                    {x.direction && (
                      <span
                        className={`ai-impact-dir ai-impact-dir-${directionClass(x.direction)}`}
                      >
                        {directionLabel(t, x.direction)}
                      </span>
                    )}
                    <span className="ai-impact-aud">{x.audience}</span>
                    <span className="ai-impact-desc">{x.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {forwardSignal && (
            <div className="ai-insight-block">
              <div className="ai-insight-head">
                <svg className="ai-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="12" cy="12" r="2" />
                  <path d="M7.5 7.5a6 6 0 000 9M16.5 7.5a6 6 0 010 9M4.5 4.5a10 10 0 000 15M19.5 4.5a10 10 0 010 15" />
                </svg>
                <span className="ai-insight-label">{t("insightForward")}</span>
              </div>
              <div className="ai-insight-body">{forwardSignal}</div>
            </div>
          )}
          {tags && (
            <div className="ai-tags">
              {tags.map((tg, i) => (
                <span key={i} className="ai-tag">{tg}</span>
              ))}
            </div>
          )}
          {article.importanceScore != null && (
            <div className="ai-importance">
              {t("importance")} <b>{article.importanceScore}</b>/100
            </div>
          )}
          {article.entities && article.entities.length > 0 && (
            <div className="entity-chips">
              <span className="entity-chips-label">{t("entities")}</span>
              {article.entities.slice(0, 6).map((ent, i) => (
                <a
                  key={i}
                  className="entity-chip"
                  href={`/${locale}/entity/${encodeURIComponent(ent)}`}
                >
                  {ent}
                </a>
              ))}
            </div>
          )}
          </div>
        </div>
      ) : null}
    </li>
  );
}
