"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { pickTitle } from "@/lib/i18n";
import { useMounted } from "@/lib/use-mounted";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
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

function StreamItem({ entry }: { entry: StreamEntry }) {
  const tArticle = useTranslations("article");
  const locale = useLocale();
  const mounted = useMounted();
  const { primary } = pickTitle(entry, locale);
  // 挂载前用显式 UTC 渲染（服务端与客户端首帧字符串一致，避免 hydration 不匹配）；
  // 挂载后切本地时区的相对时间（「3 分钟前」）
  const time = mounted
    ? formatRelativeTime(entry.publishedAt, locale)
    : formatDateTime(
        entry.publishedAt,
        locale,
        {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        },
      );
  const score = entry.importanceScore ?? entry.scoreFinal;

  return (
    <div className="v2-stream-item">
      <span className="v2-stream-time">{time}</span>
      <a
        className="v2-stream-title"
        href={entry.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {primary}
      </a>
      <span className="v2-stream-side">
        {entry.eventKey && (
          <Link href={`/event/${entry.eventKey}`}>{tArticle("event")}</Link>
        )}
        {score != null && score >= 65 && (
          <span className="v2-stream-score">{score}</span>
        )}
        <span>{entry.sourceName}</span>
      </span>
    </div>
  );
}

export function V2Stream({
  initialItems,
  initialCursor,
}: {
  initialItems: StreamEntry[];
  initialCursor: string | null;
}) {
  const t = useTranslations("v2");
  const locale = useLocale();
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
      const res = await fetch(
        `/api/news?locale=${locale}&sort=time&limit=${PAGE_LIMIT}&hours=168&cursor=${encodeURIComponent(cursor)}`,
      );
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
  }, [cursor, locale]);

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
    return <div className="v2-empty">{t("empty")}</div>;
  }

  return (
    <div>
      <div className="v2-stream">
        {items.map((entry) => (
          <StreamItem key={entry.id} entry={entry} />
        ))}
      </div>
      <div className="v2-stream-foot">
        {cursor ? (
          <button
            type="button"
            className="v2-load-btn"
            onClick={() => void loadMore()}
            disabled={loading}
          >
            {loading ? t("loading") : t("loadMore")}
          </button>
        ) : (
          <span>{t("endOfStream")}</span>
        )}
      </div>
      <div ref={sentinelRef} />
    </div>
  );
}
