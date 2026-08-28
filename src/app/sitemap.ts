import type { MetadataRoute } from "next";
import { getDailyDates, listEntityNames, listEventKeys } from "@/lib/news";

const BASE = "https://aihot.cataito.com";
const LOCALES = ["en", "zh", "ja", "es", "fr"] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const items: MetadataRoute.Sitemap = [];

  for (const locale of LOCALES) {
    items.push({
      url: `${BASE}/${locale}`,
      changeFrequency: "always",
      priority: locale === "en" ? 1 : 0.95,
      lastModified: new Date(),
    });
    items.push({
      url: `${BASE}/${locale}/daily`,
      changeFrequency: "daily",
      priority: 0.7,
    });
  }
  items.push({
    url: `${BASE}/rss.xml`,
    changeFrequency: "always",
    priority: 0.9,
  });

  // 每日简报存档页（近 30 天）
  let dailyDates: { date: string; count: number }[] = [];
  try {
    dailyDates = await getDailyDates(30);
  } catch {
    // sitemap 不应因数据库抖动而失败
  }
  for (const { date } of dailyDates) {
    for (const locale of LOCALES) {
      items.push({
        url: `${BASE}/${locale}/daily/${date}`,
        changeFrequency: "weekly",
        priority: 0.6,
        lastModified: `${date}T23:59:59.000Z`,
      });
    }
  }

  // 跨源事件详情页
  let eventKeys: string[] = [];
  try {
    eventKeys = await listEventKeys(200);
  } catch {
    // sitemap 不应因数据库抖动而失败
  }
  for (const ek of eventKeys) {
    for (const locale of LOCALES) {
      items.push({
        url: `${BASE}/${locale}/event/${ek}`,
        changeFrequency: "daily",
        priority: 0.6,
      });
    }
  }

  // 实体聚合页（近 30 天高频实体）
  let entityNames: string[] = [];
  try {
    entityNames = await listEntityNames(100);
  } catch {
    // sitemap 不应因数据库抖动而失败
  }
  for (const name of entityNames) {
    for (const locale of LOCALES) {
      items.push({
        url: `${BASE}/${locale}/entity/${encodeURIComponent(name)}`,
        changeFrequency: "weekly",
        priority: 0.5,
      });
    }
  }

  return items;
}
