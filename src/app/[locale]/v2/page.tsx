import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FpNav } from "@/components/v2/fp-nav";
import { FpLead, FpBriefs, FpWatch, FpInsights } from "@/components/v2/fp-front";
import { FpWire } from "@/components/v2/fp-wire";
import { getDailyTop, getStreamLite } from "@/lib/news-v2";

export const runtime = "edge";

/** 白名单校验：只接受 sources.category 的四个合法值，其余一律视为「全部」 */
const VALID_CATEGORIES = new Set(["official", "media-cn", "media-en", "community"]);

interface V2SearchParams {
  category?: string | string[];
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("v2");
  // 原型页：不进索引、不进 sitemap
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
    getDailyTop({ hours: 48, limit: 24, categories }),
    getStreamLite(undefined, 40, 168, categories),
    getTranslations("v2"),
  ]);

  // 候选池三层切分（同一查询，零算法改动）：
  // top4 头条+要闻 → 多源事件进「持续关注」→ 剩余按时间进「AI 洞察流」
  const lead = top.items[0];
  const briefs = top.items.slice(1, 4);
  const rest = top.items.slice(4);
  const watch = rest
    .filter((a) => a.eventId && (top.eventSourceCounts.get(a.eventId) ?? 0) >= 2)
    .slice(0, 3);
  const watchIds = new Set(watch.map((a) => a.id));
  const insights = rest
    .filter((a) => !watchIds.has(a.id))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, 8);

  return (
    <>
      <FpNav locale={locale} activeCategory={category} />
      {/* key 的双重作用：切换分类时重挂载触发 fp-enter 进场动画，同时重置 FpWire 的客户端列表状态 */}
      <main className="fp-main" key={category ?? "all"}>
        {lead ? (
          <FpLead
            article={lead}
            locale={locale}
            eventSources={
              lead.eventId ? top.eventSourceCounts.get(lead.eventId) : undefined
            }
          />
        ) : (
          <div className="fp-empty">{tV2("picksEmpty")}</div>
        )}

        {(briefs.length > 0 || watch.length > 0) && (
          <div className={briefs.length > 0 && watch.length > 0 ? "fp-cols" : undefined}>
            {briefs.length > 0 ? <FpBriefs items={briefs} locale={locale} /> : <div />}
            <FpWatch
              items={watch}
              locale={locale}
              eventSourceCounts={top.eventSourceCounts}
            />
          </div>
        )}

        <div className={insights.length > 0 ? "fp-cols fp-cols-wire" : undefined}>
          <FpInsights items={insights} locale={locale} />
          <section>
            <div className="fp-sec-hd">
              <span className="l">{tV2("wireTitle")}</span>
              <span className="r">{tV2("wireSubtitle")}</span>
            </div>
            <FpWire
              initialItems={stream.items}
              initialCursor={stream.nextCursor}
              category={category}
            />
          </section>
        </div>
      </main>
    </>
  );
}
