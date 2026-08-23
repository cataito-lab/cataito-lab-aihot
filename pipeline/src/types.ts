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
}

export interface RawItem {
  sourceId: string;
  title: string;
  url: string;
  publishedAt: string;
  author?: string;
}

export interface FetchResult {
  sourceId: string;
  items: RawItem[];
  error?: string;
}
