import type { MetadataRoute } from "next";

export default function sitemapIndex(): MetadataRoute.Sitemap {
  const BASE = "https://aihot.cataito.com";
  const LOCALES = ["en", "zh", "ja", "es", "fr"] as const;

  const items: MetadataRoute.Sitemap = [];
  for (const locale of LOCALES) {
    items.push({
      url: `${BASE}/${locale}`,
      changeFrequency: "always",
      priority: locale === "en" ? 1 : 0.95,
      lastModified: new Date(),
    });
    items.push({
      url: `${BASE}/${locale}/favorites`,
      changeFrequency: "weekly",
      priority: 0.5,
      lastModified: new Date(),
    });
  }
  items.push({
    url: `${BASE}/rss.xml`,
    changeFrequency: "always",
    priority: 0.9,
    lastModified: new Date(),
  });
  return items;
}