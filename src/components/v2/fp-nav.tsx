import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";

/**
 * 版面导航（报纸的「版面索引」条）：信源分类 + 往期归档入口。
 * 分类值必须与 sources.category 一致（official / media-cn / media-en / community）。
 */
const SOURCE_CATEGORIES = [
  { id: "all", key: "all" },
  { id: "official", key: "official" },
  { id: "media-cn", key: "mediaCn" },
  { id: "media-en", key: "mediaEn" },
  { id: "community", key: "community" },
] as const;

export async function FpNav({
  locale,
  activeCategory,
}: {
  locale: string;
  activeCategory?: string;
}) {
  const tHeader = await getTranslations({ locale, namespace: "header" });
  const tV2 = await getTranslations({ locale, namespace: "v2" });

  return (
    <nav className="fp-nav" aria-label={tHeader("categories")}>
      <div className="fp-nav-cats">
        {SOURCE_CATEGORIES.map((c) => {
          const active = c.id === "all" ? !activeCategory : activeCategory === c.id;
          return (
            <Link
              key={c.id}
              href={c.id === "all" ? "/v2" : `/v2?category=${c.id}`}
              className="fp-nav-link"
              data-active={active}
              aria-current={active ? "page" : undefined}
            >
              {tHeader(c.key)}
            </Link>
          );
        })}
      </div>
      <Link href="/daily" className="fp-nav-archive">
        {tV2("archive")}
      </Link>
    </nav>
  );
}
