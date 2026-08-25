import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

const intlMiddleware = createMiddleware(routing);

export default function middleware(request: NextRequest) {
  const response = intlMiddleware(request);
  // 新闻站页面内容必须实时：禁止边缘/浏览器缓存 HTML（防止内容冻结在缓存快照里）
  response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|favicon.ico|robots.txt|sitemap.xml|sitemap-index.xml|rss.xml|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)"],
};
