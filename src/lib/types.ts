export interface FeedArticle {
  id: string;
  sourceId: string;
  sourceName: string;
  category: string;
  lang: string;
  title: string;
  titleZh: string | null;
  summary: string | null;
  url: string;
  author: string | null;
  publishedAt: string;
  fetchedAt?: string;
  isNew?: boolean;
}

export interface FeedPage {
  items: FeedArticle[];
  nextCursor: string | null;
}

export interface FeedFilters {
  category?: string;
  categories?: string[];
  sourceId?: string;
  q?: string;
  hours?: number;
}

export const CATEGORY_IDS = ["official", "media-cn", "media-en", "community"] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  official: "官方动态",
  "media-cn": "中文媒体",
  "media-en": "英文媒体",
  community: "社区讨论",
};

export interface CategoryCount {
  id: string;
  count: number;
}

export interface BriefMeta {
  updatedAt: string | null;
  total: number;
  last24h: number;
  sourcesEnabled: number;
  categoryCounts: CategoryCount[];
}
