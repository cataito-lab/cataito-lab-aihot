"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Tray } from "@phosphor-icons/react";
import { isRecent } from "@/lib/article-utils";
import type { FeedArticle, FeedFilters, FeedPage } from "@/lib/types";
import { ArticleItem } from "./article-item";

interface HourGroup {
  key: string;
  label: string;
  items: FeedArticle[];
}

function groupByHour(items: FeedArticle[]): HourGroup[] {
  const fmtHour = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const fmtDay = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" });
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups: HourGroup[] = [];
  let current: HourGroup | null = null;
  for (const item of items) {
    const d = new Date(item.publishedAt);
    const dayStr = d.toDateString();
    const dayLabel =
      dayStr === today ? "今天" : dayStr === yesterday ? "昨天" : fmtDay.format(d);
    const key = `${dayStr}-${d.getHours()}`;
    const label = `${dayLabel} ${fmtHour.format(d)}`;
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
  if (filters.categories && filters.categories.length > 0) {
    params.set("cats", filters.categories.join(","));
  }
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
            ...page.items
              .filter((i) => !seen.has(i.id))
              .map((i) => ({
                ...i,
                isNew: isRecent(i.publishedAt),
              })),
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
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore, cursor]);

  const groups = useMemo(() => groupByHour(items), [items]);
  const indexedGroups = useMemo(() => {
    let idx = -1;
    return groups.map((g) => ({
      ...g,
      items: g.items.map((item) => ({ item, index: ++idx })),
    }));
  }, [groups]);

  return (
    <div className="relative">
      <span
        aria-hidden
        className="absolute left-[8px] top-2 bottom-2 w-px bg-gradient-to-b from-neon/40 via-line to-transparent"
      />
      {indexedGroups.map((group) => (
        <section key={group.key} className="pt-6">
          <div className="flex items-center gap-3 pb-1">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-fg-secondary bg-bg pr-2 py-0.5">
              <span aria-hidden className="text-neon mr-1.5">{"//"}</span>
              {group.label}
            </span>
            <span aria-hidden className="h-px flex-1 bg-line/60" />
            <span className="font-mono text-[10px] text-fg-muted tabular-nums">
              ×{group.items.length}
            </span>
          </div>
          <ol>
            {group.items.map(({ item, index }) => (
              <ArticleItem key={item.id} article={item} index={index} />
            ))}
          </ol>
        </section>
      ))}

      {items.length === 0 && (
        <div className="py-28 flex flex-col items-center gap-3 text-center animate-fade-up">
          <span className="w-14 h-14 rounded-full border border-line flex items-center justify-center text-fg-muted">
            <Tray size={24} />
          </span>
          <p className="text-[15px] text-fg-secondary">当前筛选下暂无简报</p>
          <p className="text-[13px] text-fg-muted">
            调整偏好类别或清除搜索关键词试试
          </p>
        </div>
      )}

      <div ref={sentinelRef} className="h-px" />

      {cursor && (
        <div className="pt-6 pb-2 pl-6 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-accent/30 text-accent hover:bg-neon-soft font-mono text-xs tracking-wider transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <ArrowDown size={13} className={loading ? "animate-bounce" : ""} />
            {loading ? "LOADING…" : "LOAD_MORE"}
          </button>
        </div>
      )}
    </div>
  );
}
