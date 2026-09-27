import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/header";
import { ArticleItem } from "@/components/article-item";
import { getEntityArticles } from "@/lib/news";
import { DegradedNote } from "@/components/degraded-note";
import type { FeedArticle } from "@/lib/types";

const SITE_URL = "https://aihot.cataito.com";

export const runtime = "edge";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; name: string }>;
}): Promise<Metadata> {
  const { locale, name } = await params;
  const entity = decodeURIComponent(name);
  const t = await getTranslations({ locale, namespace: "entity" });
  const title = t("title", { name: entity });
  const description = t("description", { name: entity });
  const path = `/${locale}/entity/${name}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${path}`,
      type: "website",
      siteName: "AI 热点简报",
      locale,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function EntityPage({
  params,
}: {
  params: Promise<{ locale: string; name: string }>;
}) {
  const { locale, name } = await params;
  setRequestLocale(locale);
  const entity = decodeURIComponent(name);
  const t = await getTranslations("entity");
  let items: FeedArticle[] = [];
  let degraded = false;
  try {
    items = await getEntityArticles(entity);
  } catch (err) {
    degraded = true;
    console.error(`[entity/${entity}] 读取失败，降级渲染:`, err);
  }

  return (
    <>
      <Header />
      <main className="site-main">
        {degraded && <DegradedNote />}
        <Link href="/" className="event-back">
          {t("back")}
        </Link>

        <div className="entity-head">
          <h1 className="entity-title">{t("title", { name: entity })}</h1>
          {!degraded && <p className="entity-count">{t("count", { n: items.length })}</p>}
        </div>

        {degraded ? null : items.length > 0 ? (
          <ul className="feed-list">
            {items.map((a, i) => (
              <ArticleItem key={a.id} article={a} index={i} />
            ))}
          </ul>
        ) : (
          <p className="empty">{t("empty", { name: entity })}</p>
        )}
      </main>
    </>
  );
}
