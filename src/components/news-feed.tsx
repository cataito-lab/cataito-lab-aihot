"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Tray } from "@phosphor-icons/react";
import { isRecent } from "@/lib/article-utils";
import { useMounted } from "@/lib/use-mounted";
import type { FeedArticle, FeedFilters, FeedPage } from "@/lib/types";
import { ArticleItem } from "./article-item";
import { EventCard } from "./event-card";

type FeedCard =
  | { kind: "single"; article: FeedArticle }
  | { kind: "event"; items: FeedArticle[] };

interface TimeGroup {
  key: string;
  label: string;
  cards: { card: FeedCard; index: number }[];
}

/** 用统一 key 格式化器取出某时区下的 day/hour 标识 */
function tzStamp(
  fmt: Intl.DateTimeFormat,
  d: Date,
): { day: string; hour: string } {
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: get("hour") };
}

/** 卡片的时间锚点：单条=自身发布时间；事件=其成员的最新时间。 */
function canonicalTime(card: FeedCard): string {
  if (card.kind === "single") return card.article.publishedAt;
  return card.items.reduce(
    (m, i) => (i.publishedAt > m ? i.publishedAt : m),
    card.items[0].publishedAt,
  );
}

/**
 * 全局折叠：同一 eventId 的多条报道合并为一张事件卡（无论它们跨不跨小时），
 * 其余按 id 单列。返回顺序保留首见顺序（即最新在前，因 items 已按 publishedAt DESC 排序）。
 * 非事件项（eventId 为 null）以自身成组，与旧行为一致。
 */
function foldCards(items: FeedArticle[]): FeedCard[] {
  const byKey = new Map<string, FeedArticle[]>();
  const order: string[] = [];
  for (const it of items) {
    const key = it.eventId ? `e:${it.eventId}` : `s:${it.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(it);
  }
  return order.map((k) => {
    const arr = byKey.get(k)!;
    return arr.length > 1
      ? { kind: "event" as const, items: arr }
      : { kind: "single" as const, article: arr[0] };
  });
}

function groupByTime(
  cards: FeedCard[],
  locale: string,
  t: ReturnType<typeof useTranslations<"feed">>,
  timeZone?: string,
): TimeGroup[] {
  // 挂载前显式用 UTC（与 edge SSR 一致，保证两端 DOM 结构相同）；
  // 挂载后传 undefined = 访客本地时区
  const fmtHour = new Intl.DateTimeFormat(locale, {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone,
  });
  const fmtDay = new Intl.DateTimeFormat(locale, {
    month: "2-digit", day: "2-digit", timeZone,
  });
  const keyFmt = new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false, timeZone,
  });
  const nowMs = Date.now();
  const todayKey = tzStamp(keyFmt, new Date(nowMs)).day;
  const yesterKey = tzStamp(keyFmt, new Date(nowMs - 86_400_000)).day;
  let seenToday = false;
  const groups: TimeGroup[] = [];
  let current: TimeGroup | null = null;
  let idx = -1;
  for (const card of cards) {
    const d = new Date(canonicalTime(card));
    const k = tzStamp(keyFmt, d);
    const time = fmtHour.format(d);
    // 紧凑宽度约定：今天的首个分组带「今日」日词，后续只显示 HH:MM；
    // 历史日期（含「昨日」）逐组保留，便于向下滚动时定位
    let dayPrefix: string;
    if (k.day === todayKey) {
      dayPrefix = seenToday ? "" : t("today");
      seenToday = true;
    } else if (k.day === yesterKey) {
      dayPrefix = t("yesterday");
    } else {
      dayPrefix = fmtDay.format(d);
    }
    const label = dayPrefix ? `${dayPrefix}\n${time}` : time;
    const key = `${k.day}-${k.hour}`;
    if (!current || current.key !== key) {
      current = { key: `${key}-${groups.length}`, label, cards: [] };
      groups.push(current);
    }
    current.cards.push({ card, index: ++idx });
  }
  return groups;
}

function buildQuery(filters: FeedFilters, cursor?: string | null, locale?: string): string {
  const params = new URLSearchParams();
  if (filters.categories && filters.categories.length > 0) params.set("cats", filters.categories.join(","));
  if (filters.category && filters.category !== "all") params.set("category", filters.category);
  if (filters.sourceId) params.set("source", filters.sourceId);
  if (filters.q) params.set("q", filters.q);
  if (filters.hours) params.set("hours", String(filters.hours));
  if (filters.sort && filters.sort !== "time") params.set("sort", filters.sort);
  if (locale) params.set("locale", locale);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function NewsFeed({
  initialItems,
  initialCursor,
  filters,
}: {
  initialItems: FeedArticle[];
  initialCursor: string | null;
  filters: FeedFilters;
}) {
  const tFeed = useTranslations("feed");
  const tBrief = useTranslations("briefing");
  const locale = useLocale();
  const mounted = useMounted();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<"time" | "importance">(filters.sort ?? "time");
  const effectiveFilters = useMemo(() => ({ ...filters, sort }), [filters, sort]);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const qs = buildQuery(effectiveFilters, cursor, locale);
      const res = await fetch(`/api/news${qs ? `?${qs}` : ""}`);
      if (res.ok) {
        const page = (await res.json()) as FeedPage;
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          return [
            ...prev,
            ...page.items.filter((i) => !seen.has(i.id)).map((i) => ({ ...i, isNew: isRecent(i.publishedAt) })),
          ];
        });
        setCursor(page.nextCursor);
      }
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, effectiveFilters, locale]);

  const loadFirst = useCallback(async (s: "time" | "importance") => {
    setLoading(true);
    try {
      const qs = buildQuery({ ...filters, sort: s }, undefined, locale);
      const res = await fetch(`/api/news${qs ? `?${qs}` : ""}`);
      if (res.ok) {
        const page = (await res.json()) as FeedPage;
        setItems(page.items.map((i) => ({ ...i, isNew: isRecent(i.publishedAt) })));
        setCursor(page.nextCursor);
      }
    } finally {
      setLoading(false);
    }
  }, [filters, locale]);

  function handleSort(s: "time" | "importance") {
    if (s === sort) return;
    setSort(s);
    void loadFirst(s);
  }

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) void loadMore(); },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, cursor]);

  // 先全局折叠（跨小时同源事件也合并），再按事件的时间锚点归组
  const cards = useMemo(() => foldCards(items), [items]);
  const groups = useMemo(
    () => groupByTime(cards, locale, tFeed, mounted ? undefined : "UTC"),
    [cards, locale, tFeed, mounted],
  );

  return (
    <>
      <div className="feed-toolbar">
        <div className="sort-toggle" role="group" aria-label={tFeed("sortLabel")}>
          <button
            type="button"
            className={sort === "time" ? "active" : ""}
            aria-pressed={sort === "time"}
            onClick={() => handleSort("time")}
          >
            {tFeed("sortLatest")}
          </button>
          <button
            type="button"
            className={sort === "importance" ? "active" : ""}
            aria-pressed={sort === "importance"}
            onClick={() => handleSort("importance")}
          >
            {tFeed("sortImportant")}
          </button>
        </div>
      </div>

      <div className="timeline-container">
        {groups.map((group) => (
          <section key={group.key} className="timeline-group">
            <div className="time-marker" suppressHydrationWarning>
              {group.label}
            </div>
            <ol className="timeline-cards">
              {group.cards.map(({ card, index }) =>
                card.kind === "event" ? (
                  <EventCard
                    key={`e-${card.items[0].eventId}`}
                    items={card.items}
                    index={index}
                    eventKey={card.items[0].eventKey}
                  />
                ) : (
                  <ArticleItem key={card.article.id} article={card.article} index={index} />
                ),
              )}
            </ol>
          </section>
        ))}

        {items.length === 0 && (
          <div className="py-28 flex flex-col items-center gap-3 text-center animate-fade-up">
            <span className="w-14 h-14 rounded-full border border-[var(--border-color)] flex items-center justify-center text-[var(--text-muted)]">
              <Tray size={24} />
            </span>
            <p className="text-[15px] text-[var(--text-secondary)]">{tFeed("emptyTitle")}</p>
            <p className="text-[13px] text-[var(--text-muted)]">{tFeed("emptyHint")}</p>
          </div>
        )}
      </div>

      <div ref={sentinelRef} className="h-px" />

      {cursor && (
        <div className="pt-6 pb-2 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] font-mono text-xs tracking-wider transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {loading ? tBrief("loading") : tBrief("loadMore")}
          </button>
        </div>
      )}
    </>
  );
}
