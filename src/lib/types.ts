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
  /** 所属事件 ID（跨源同事件合并用；单篇事件/非事件项为其自身 id） */
  eventId: string | null;
  /** 事件 key（slug），用于事件详情页路由；单篇事件/非事件项时为 null */
  eventKey: string | null;
  /** 事件级综合摘要（来自 events 表；仅当该文章属于多源事件且有综合时非空） */
  eventSummary: string | null;
}

/** 事件详情页中的单条成员报道 */
export interface EventMember {
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
  /** AIHOT 综合评分 0-100（未评分为 null） */
  scoreFinal: number | null;
  url: string;
  author: string | null;
  publishedAt: string;
}

/** 事件详情（跨源聚类结果） */
export interface EventDetail {
  id: string;
  eventKey: string;
  title: string | null;
  titleZh: string | null;
  /** 事件级综合摘要（中文） */
  summary: string | null;
  /** 事件级综合摘要（英文） */
  summaryEn: string | null;
  /** 参与该事件的信源数 */
  sourceCount: number;
  firstSeen: string;
  lastSeen: string;
  /** 成员中的最高评分 */
  peakScore: number | null;
  members: EventMember[];
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
