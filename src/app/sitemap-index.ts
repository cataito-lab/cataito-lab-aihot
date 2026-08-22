import type { MetadataRoute } from "next";

export default function sitemapIndex(): MetadataRoute.Sitemap {
  const BASE = "https://aihot.cataito.com";

  return [
    {
      url: BASE,
      changeFrequency: "always",
      priority: 1,
      lastModified: new Date(),
    },
    {
      url: `${BASE}/rss.xml`,
      changeFrequency: "always",
      priority: 0.9,
      lastModified: new Date(),
    },
    {
      url: `${BASE}/favorites`,
      changeFrequency: "weekly",
      priority: 0.5,
      lastModified: new Date(),
    },
  ];
}