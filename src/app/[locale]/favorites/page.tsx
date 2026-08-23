"use client";

import {
  useTranslations,
} from "next-intl";
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
import { Star } from "@phosphor-icons/react";
import type { FeedArticle } from "@/lib/types";
import { ArticleItem } from "@/components/article-item";
import { withFreshness } from "@/lib/article-utils";

// Locale-agnostic API root — next-intl middleware adds a locale prefix to the
// user-visible path, but the underlying API routes live at /api/... . Fetching
// the absolute path keeps the call working in every locale without us having
// to re-route API handlers.
const API = "/api";

function useFavorites(): string[] {
  return useSyncExternalStore(subscribeFavorites, readFavorites, () => []);
}

async function fetchArticlesByIds(ids: string[]): Promise<Record<string, FeedArticle>> {
  if (ids.length === 0) return {};
  const r = await fetch(`${API}/favorites?ids=${encodeURIComponent(ids.join(","))}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data: { articles: FeedArticle[] } = await r.json();
  const map: Record<string, FeedArticle> = {};
  for (const a of data.articles ?? []) map[a.id] = a;
  return map;
}

export default function FavoritesPage() {
  const t = useTranslations("favorites");
  const [map, setMap] = useState<Record<string, FeedArticle>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const favIds = useFavorites();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const m = await fetchArticlesByIds(favIds);
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
    return () => { cancelled = true; };
  }, [favIds.join(",")]);

  const loaded = withFreshness(Object.values(map));

  return (
    <section className="min-h-[60vh]">
      <div className="flex items-center gap-3 pb-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-muted">
          {t("heading")}
        </span>
        <span aria-hidden className="h-px flex-1 bg-line" />
        <span className="font-mono text-[11px] tabular-nums text-fg-muted">
          {favIds.length} {t("saved")}
        </span>
      </div>

      {favIds.length === 0 ? (
        <div className="py-24 flex flex-col items-center gap-3 text-fg-muted">
          <div className="w-16 h-16 rounded-full bg-surface flex items-center justify-center">
            <Star size={28} weight="regular" className="text-fg-muted" />
          </div>
          <p className="text-[15px] text-fg">{t("empty")}</p>
          <p className="text-[13px] text-fg-muted">{t("emptyHint")}</p>
        </div>
      ) : loading ? (
        <p className="text-[13px] text-fg-muted py-6">{t("loading")}</p>
      ) : error ? (
        <p className="text-[13px] text-red-500 py-6">{t("error", { error })}</p>
      ) : (
        <ul className="relative ml-0">
          {loaded
            .map((a, i) => <li key={a.id}><ArticleItem article={a} index={i} /></li>)}
        </ul>
      )}
    </section>
  );
}