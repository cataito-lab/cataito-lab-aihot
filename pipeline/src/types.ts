export type SourceCategory = "official" | "media-cn" | "media-en" | "community";

export type FetcherKind = "rss" | "hn-algolia" | "html" | "bridge" | "reddit";

export interface SourceDef {
  id: string;
  name: string;
  category: SourceCategory;
  lang: "zh" | "en";
  siteUrl: string;
  feedUrl: string | null;
  fetcher: FetcherKind;
  dedicated: boolean;
  enabled: boolean;
  /** 源站 pubDate 的实际时区。默认视为 UTC（标准 RSS 行为）。
   * 部分中文源（如 InfoQ / 量子位）把北京时间错标为 GMT，
   * 用此字段声明后 pipeline 会按真实时区换算成 UTC 入库，
   * 前端 +8 换算后正好显示源站原始时间。 */
  publishedAtTz?: string;
  note?: string;
  /** 信源权威度 0-100（评分系统独立维度，见 docs/SCORING-ROADMAP.md） */
  authority?: number;
}

export interface RawItem {
  sourceId: string;
  title: string;
  url: string;
  publishedAt: string;
  /** 原文发布时间标注的实际时区（如 "Asia/Shanghai"）。无此字段时前端视为 UTC 显示。 */
  sourceTimezone?: string;
  /** 是否为估算/反推时间（原文无明确时间时） */
  estimated?: boolean;
  author?: string;
  /** RSS 自带正文/摘要（去 HTML 后截断），供摘要生成参考；无则为空 */
  articleContent?: string;
}

export interface FetchResult {
  sourceId: string;
  items: RawItem[];
  error?: string;
}
