export type SourceCategory = "official" | "media-cn" | "media-en" | "community";

export type FetcherKind = "rss" | "hn-algolia" | "html" | "bridge";

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
