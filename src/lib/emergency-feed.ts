import snapshot from "../../public/emergency-feed.json";

export interface EmergencyItem {
  id: string;
  sourceId: string;
  sourceName: string;
  category: string;
  lang: string;
  title: string;
  url: string;
  publishedAt: string;
  excerpt: string | null;
}

interface EmergencySnapshot {
  generatedAt: string | null;
  windowHours: number;
  sourcesOk: number;
  sourcesFailed: number;
  items: EmergencyItem[];
}

const data = snapshot as EmergencySnapshot;

/**
 * 应急快照：由 pipeline/scripts/emergency-snapshot.ts 在构建时抓信源生成。
 * 只在数据库读不到时兜底渲染；generatedAt 为 null 表示这份快照从未成功过。
 */
export function emergencyItems(): EmergencyItem[] {
  return data.generatedAt && data.items.length > 0 ? data.items : [];
}

export function emergencyGeneratedAt(): string | null {
  return data.generatedAt;
}
