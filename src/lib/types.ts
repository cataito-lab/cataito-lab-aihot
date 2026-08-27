export interface FeedArticle {
  id: string;
  sourceId: string;
  sourceName: string;
  category: string;
  lang: string;
  title: string;
  titleZh: string | null;
  summary: string | null;
  summaryEn: string | null;
  summaryJa: string | null;
  summaryEs: string | null;
  summaryFr: string | null;
  /** 核心要点（中文，JSON 数组字符串），仅中文界面展示 */
  keyPoints: string | null;
  /** 一句话行业影响（中文） */
  industryImpact: string | null;
  /** AIHOT 综合评分 0-100（未评分为 null，前端保底展示） */
  scoreFinal: number | null;
  url: string;
  author: string | null;
  publishedAt: string;
  fetchedAt?: string;
  /** 原文发布时区（如 "Asia/Shanghai" / "UTC"），仅当非 UTC 时前端才展示 */
  sourceTimezone?: string;
  /** 是否为估算时间 */
  estimated?: boolean;
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
  sort?: "time" | "importance";
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
