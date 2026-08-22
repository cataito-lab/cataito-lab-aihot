"use client";

import Link from "next/link";
import { ArticleItem } from "@/components/article-item";
import {
  useState,
  useEffect,
  useSyncExternalStore,
} from "react";
import {
  subscribeFavorites,
  toggleFavorite,
  readFavorites,
} from "@/lib/favorites";
import {
  Star,
  ArrowClockwise,
} from "@phosphor-icons/react";
import type { FeedArticle } from "@/lib/types";

function useFavorites(): string[] {
  return useSyncExternalStore(
    subscribeFavorites,
    readFavorites,
    () => [],
  );
}

/**
 * 一次性把收藏的 id 全量从数据库拉出来（最多 200 条）。
 * 收藏视图本质是"按 id 过滤"，最省的做法是客户端缓存一份 id→article 的 map。
 */
async function fetchArticlesByIds(ids: string[]): Promise<Record<string, FeedArticle>> {
  if (ids.length === 0) return {};
  const r = await fetch(`/api/favorites?ids=${encodeURIComponent(ids.join(","))}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data: { articles: FeedArticle[] } = await r.json();
  const map: Record<string, FeedArticle> = {};
  for (const a of data.articles ?? []) {
    map[a.id] = a;
  }
  return map;
}

export default function FavoritesPage() {
  const favoriteIds = useFavorites();
  const [map, setMap] = useState<Record<string, FeedArticle>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const m = await fetchArticlesByIds(favoriteIds);
        if (cancelled) return;
        setMap(m);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [favoriteIds.join(",")]);

  return (
    <section className="min-h-[60vh]">
      <div className="flex items-center gap-3 pb-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted">
          My Favorites
        </span>
        <span aria-hidden className="h-px flex-1 bg-line" />
        <span className="font-mono text-[11px] tabular-nums text-fg-muted">
          {favoriteIds.length} saved
        </span>
        <button
          type="button"
          onClick={() => {
            setLoading(true);
            fetchArticlesByIds(favoriteIds).then((m) => {
              setMap(m);
              setLoading(false);
              setError(null);
            }).catch((e) => {
              setError(String(e));
              setLoading(false);
            });
          }}
          aria-label="刷新收藏"
          className="font-mono text-[11px] text-neon hover:text-accent-strong transition-colors cursor-pointer inline-flex items-center gap-1"
        >
          <ArrowClockwise size={11} weight="regular" />
          刷新
        </button>
      </div>

      {favoriteIds.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-3 text-fg-muted">
          <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center">
            <Star size={28} weight="regular" className="text-fg-muted" />
          </div>
          <p className="text-[15px] text-fg">还没有收藏</p>
          <p className="text-[13px] text-fg-muted">
            在时间线里点星标即可收藏，这里会自动汇总
          </p>
          <Link
            href="/"
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-fg text-bg text-[13px] font-medium hover:bg-fg/90 transition-colors"
          >
            去浏览 AI 热点
          </Link>
        </div>
      ) : loading ? (
        <p className="text-[13px] text-fg-muted py-6">加载中…</p>
      ) : error ? (
        <p className="text-[13px] text-red-500 py-6">加载失败：{error}</p>
      ) : (
        <ul className="relative ml-0">
          {favoriteIds
            .map((id) => map[id])
            .filter((a): a is FeedArticle => !!a)
            .map((article, i) => (
              <li key={article.id}>
                <ArticleItem article={article} index={i} />
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}