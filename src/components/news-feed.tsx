"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Tray } from "@phosphor-icons/react";
import { isRecent } from "@/lib/article-utils";
import type { FeedArticle, FeedFilters, FeedPage } from "@/lib/types";
import { ArticleItem } from "./article-item";

interface TimeGroup {
  key: string;
  label: string;
  items: FeedArticle[];
}

function groupByTime(items: FeedArticle[], locale: string, t: ReturnType<typeof useTranslations<"feed">>): TimeGroup[] {
  const fmtHour = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtDay = new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" });
  const today = new Date().toDateString();
  const groups: TimeGroup[] = [];
  let current: TimeGroup | null = null;
  for (const item of items) {
    const d = new Date(item.publishedAt);
    const dayStr = d.toDateString();
    // 时间轴标记保持设计稿的紧凑宽度：当天只显示 HH:MM，跨天用 MM-dd 换行 HH:MM
    const dayLabel = dayStr === today ? "" : fmtDay.format(d);
    const time = fmtHour.format(d);
    const label = dayLabel ? `${dayLabel}\n${time}` : time;
    const key = `${dayStr}-${d.getHours()}`;
    if (!current || current.key !== key) {
      current = { key: `${key}-${groups.length}`, label, items: [] };
      groups.push(current);
    }
    current.items.push(item);
  }
  return groups;
}

function buildQuery(filters: FeedFilters, cursor?: string | null): string {
  const params = new URLSearchParams();
  if (filters.categories && filters.categories.length > 0) params.set("cats", filters.categories.join(","));
  if (filters.category && filters.category !== "all") params.set("category", filters.category);
  if (filters.sourceId) params.set("source", filters.sourceId);
  if (filters.q) params.set("q", filters.q);
  if (filters.hours) params.set("hours", String(filters.hours));
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
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const qs = buildQuery(filters, cursor);
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
  }, [cursor, loading, filters]);

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

  const groups = useMemo(() => groupByTime(items, locale, tFeed), [items, locale, tFeed]);
  const indexedGroups = useMemo(() => {
    let idx = -1;
    return groups.map((g) => ({ ...g, items: g.items.map((item) => ({ item, index: ++idx })) }));
  }, [groups]);

  return (
    <>
      <div className="timeline-container">
        {indexedGroups.map((group) => (
          <section key={group.key} className="timeline-group">
            <div className="time-marker" suppressHydrationWarning>
              {group.label}
            </div>
            <ol className="timeline-cards">
              {group.items.map(({ item, index }) => (
                <ArticleItem key={item.id} article={item} index={index} />
              ))}
            </ol>
          </section>
        ))}

        {items.length === 0 && (
          <div className="py-28 flex flex-col items-center gap-3 text-center animate-fade-up">
            <span className="w-14 h-14 rounded-full border border-[#222228] flex items-center justify-center text-[#71717a]">
              <Tray size={24} />
            </span>
            <p className="text-[15px] text-[#a1a1aa]">{tFeed("emptyTitle")}</p>
            <p className="text-[13px] text-[#71717a]">{tFeed("emptyHint")}</p>
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
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[#222228] bg-[#121216] text-[#a1a1aa] hover:text-[#f4f4f5] hover:border-[#3f3f46] font-mono text-xs tracking-wider transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {loading ? tBrief("loading") : tBrief("loadMore")}
          </button>
        </div>
      )}
    </>
  );
}
