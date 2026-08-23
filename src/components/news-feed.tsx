"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { ArrowDown, Tray } from "@phosphor-icons/react";
import { isRecent } from "@/lib/article-utils";
import type { FeedArticle, FeedFilters, FeedPage } from "@/lib/types";
import { ArticleItem } from "./article-item";

interface HourGroup {
  key: string;
  label: string;
  items: FeedArticle[];
}

function groupByHour(items: FeedArticle[], locale: string, t: ReturnType<typeof useTranslations<"feed">>): HourGroup[] {
  const fmtHour = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtDay = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const groups: HourGroup[] = [];
  let current: HourGroup | null = null;
  for (const item of items) {
    const d = new Date(item.publishedAt);
    const dayStr = d.toDateString();
    const dayLabel = dayStr === today ? t("today") : dayStr === yesterday ? t("yesterday") : fmtDay.format(d);
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

  const groups = useMemo(() => groupByHour(items, locale, tFeed), [items, locale, tFeed]);
  const indexedGroups = useMemo(() => {
    let idx = -1;
    return groups.map((g) => ({ ...g, items: g.items.map((item) => ({ item, index: ++idx })) }));
  }, [groups]);

  return (
    <div className="relative pl-8">
      <span aria-hidden className="absolute left-[7px] top-0 bottom-0 w-[1px] border-l border-dashed border-line" />
      {indexedGroups.map((group) => (
        <section key={group.key} className="relative pt-6 pb-8 last:pb-0">
          <span className="absolute left-[-8px] top-[22px] bg-bg pl-2 font-mono text-[11px] font-medium tabular-nums text-neon tracking-[0.02em]">
            <span className="text-neon/50 mr-1">//</span>{group.label}
          </span>
          <ol className="flex flex-col gap-2">
            {group.items.map(({ item, index }) => <ArticleItem key={item.id} article={item} index={index} />)}
          </ol>
        </section>
      ))}

      {items.length === 0 && (
        <div className="py-28 flex flex-col items-center gap-3 text-center animate-fade-up">
          <span className="w-14 h-14 rounded-full border border-line flex items-center justify-center text-fg-muted">
            <Tray size={24} />
          </span>
          <p className="text-[15px] text-fg-secondary">{tFeed("emptyTitle")}</p>
          <p className="text-[13px] text-fg-muted">{tFeed("emptyHint")}</p>
        </div>
      )}

      <div ref={sentinelRef} className="h-px" />

      {cursor && (
        <div className="pt-6 pb-2 flex justify-center">
          <button type="button" onClick={() => void loadMore()} disabled={loading} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-accent/30 text-accent hover:bg-neon-soft font-mono text-xs tracking-wider transition-all active:scale-95 disabled:opacity-50 cursor-pointer">
            <ArrowDown size={13} className={loading ? "animate-bounce" : ""} />
            {loading ? tBrief("loading") : tBrief("loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}