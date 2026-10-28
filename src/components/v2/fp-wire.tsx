"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { pickTitle } from "@/lib/i18n";
import { useMounted } from "@/lib/use-mounted";
import { formatDateTime } from "@/lib/format";
import type { StreamEntry } from "@/lib/news-v2";
import type { FeedArticle } from "@/lib/types";

const PAGE_LIMIT = 40;

function toEntry(a: FeedArticle): StreamEntry {
  return {
    id: a.id,
    sourceId: a.sourceId,
    sourceName: a.sourceName,
    category: a.category,
    lang: a.lang,
    title: a.title,
    titleZh: a.titleZh,
    titleJa: a.titleJa,
    titleEs: a.titleEs,
    titleFr: a.titleFr,
    url: a.url,
    publishedAt: a.publishedAt,
    eventId: a.eventId,
    eventKey: a.eventKey,
    scoreFinal: a.scoreFinal,
    importanceScore: a.importanceScore,
  };
}

/** 分组键与时刻标签：挂载前用 UTC（与 SSR 首帧一致防 hydration 错配），挂载后切访客本地时区 */
function groupKey(iso: string, utc: boolean): string {
  const d = new Date(iso);
  return utc
    ? `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}`
    : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
}

function groupLabel(iso: string, locale: string, utc: boolean): string {
  const d = new Date(iso);
  if (utc) d.setUTCMinutes(0, 0, 0);
  else d.setMinutes(0, 0, 0);
  return formatDateTime(d.toISOString(), locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(utc ? { timeZone: "UTC" } : {}),
  });
}

function rowTime(iso: string, locale: string, utc: boolean): string {
  return formatDateTime(iso, locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...(utc ? { timeZone: "UTC" } : {}),
  });
}

function WireItem({
  entry,
  locale,
  utc,
}: {
  entry: StreamEntry;
  locale: string;
  utc: boolean;
}) {
  const tArticle = useTranslations("article");
  const { primary } = pickTitle(entry, locale);
  const score = entry.importanceScore ?? entry.scoreFinal;

  return (
    <div className="fp-wire-item">
      <span className="fp-wire-time">{rowTime(entry.publishedAt, locale, utc)}</span>
      <a
        className="fp-wire-title"
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {primary}
      </a>
      <span className="fp-wire-side">
        {entry.eventKey && (
          <Link href={`/event/${entry.eventKey}`}>{tArticle("event")}</Link>
        )}
        {score != null && <span className="fp-wire-score">{score}</span>}
        <span className="src">{entry.sourceName}</span>
      </span>
    </div>
  );
}

export function FpWire({
  initialItems,
  initialCursor,
  category,
}: {
  initialItems: StreamEntry[];
  initialCursor: string | null;
  /** 版面分类过滤（与首屏 SSR 同一参数），翻页时同步带上 */
  category?: string;
}) {
  const t = useTranslations("v2");
  const locale = useLocale();
  const mounted = useMounted();
  const utc = !mounted;
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        locale,
        sort: "time",
        limit: String(PAGE_LIMIT),
        hours: "168",
        cursor,
      });
      if (category) qs.set("category", category);
      const res = await fetch(`/api/news?${qs.toString()}`);
      if (res.ok) {
        const page = (await res.json()) as { items: FeedArticle[]; nextCursor: string | null };
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...page.items.map(toEntry).filter((x) => !seen.has(x.id))];
        });
        setCursor(page.nextCursor);
      }
    } catch {
      // 翻页失败静默保留当前列表，下次触底重试
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [cursor, locale, category]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loadMore]);

  if (items.length === 0) {
    return <div className="fp-empty">{t("empty")}</div>;
  }

  let lastGroup = "";
  return (
    <div>
      <div>
        {items.map((entry) => {
          const g = groupKey(entry.publishedAt, utc);
          const showGroup = g !== lastGroup;
          lastGroup = g;
          return (
            <div key={entry.id}>
              {showGroup && (
                <div className="fp-wire-hour">
                  {groupLabel(entry.publishedAt, locale, utc)}
                </div>
              )}
              <WireItem entry={entry} locale={locale} utc={utc} />
            </div>
          );
        })}
      </div>
      <div className="fp-wire-foot">
        {cursor ? (
          <button
            type="button"
            className="fp-load-btn"
            onClick={() => void loadMore()}
            disabled={loading}
          >
            {loading ? t("loading") : t("loadMore")}
          </button>
        ) : (
          <span className="fp-empty">{t("endOfStream")}</span>
        )}
      </div>
      <div ref={sentinelRef} />
    </div>
  );
}
