import type { FeedArticle } from "./types";

const FRESH_WINDOW_MS = 7_200_000;

export function isRecent(publishedAt: string, windowMs = FRESH_WINDOW_MS): boolean {
  return Date.now() - new Date(publishedAt).getTime() < windowMs;
}

export function withFreshness(items: FeedArticle[]): FeedArticle[] {
  return items.map((a) => ({
    ...a,
    isNew: isRecent(a.publishedAt),
  }));
}
