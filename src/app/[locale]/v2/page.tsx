import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FpNav } from "@/components/v2/fp-nav";
import { FpFeed } from "@/components/v2/fp-front";
import { FpWire } from "@/components/v2/fp-wire";
import { FpArchive } from "@/components/v2/fp-archive";
import { getDailyTop, getStreamLite } from "@/lib/news-v2";

export const runtime = "edge";

/** 白名单校验：只接受 sources.category 的四个合法值，其余一律视为「全部」 */
const VALID_CATEGORIES = new Set(["official", "media-cn", "media-en", "community"]);

interface V2SearchParams {
  category?: string | string[];
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("v2");
  return {
    title: t("badge"),
    robots: { index: false, follow: false },
  };
}

export default async function V2Page({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<V2SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const sp = await searchParams;
  const raw = Array.isArray(sp.category) ? sp.category[0] : sp.category;
  const category = raw && VALID_CATEGORIES.has(raw) ? raw : undefined;
  const categories = category ? [category] : undefined;

  const [top, stream, tV2] = await Promise.all([
    getDailyTop({ hours: 24, limit: 24, categories }),
    getStreamLite(undefined, 40, 168, categories),
    getTranslations("v2"),
  ]);

  return (
    <>
      <FpNav locale={locale} activeCategory={category} />
      {/* key 切分类时重挂载触发 fp-enter 进场动画，同时重置 FpWire 客户端列表状态 */}
      <main className="fp-main" key={category ?? "all"}>
        {top.items.length > 0 ? (
          <div className="fp-3col">
            {/* 左栏：历史归档 */}
            <aside className="fp-3col-left">
              <FpArchive locale={locale} />
            </aside>

            {/* 中栏：全部有完整 AI 洞察的文章 */}
            <div className="fp-3col-center">
              <FpFeed
                items={top.items}
                locale={locale}
                eventSourceCounts={top.eventSourceCounts}
              />
            </div>

            {/* 右栏：电报速报 */}
            <aside className="fp-3col-right">
              <div className="fp-sec-hd">
                <span className="l">{tV2("wireTitle")}</span>
                <span className="r">{tV2("wireSubtitle")}</span>
              </div>
              <FpWire
                initialItems={stream.items}
                initialCursor={stream.nextCursor}
                category={category}
              />
            </aside>
          </div>
        ) : (
          <div className="fp-empty">{tV2("picksEmpty")}</div>
        )}
      </main>
    </>
  );
}
