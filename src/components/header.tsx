"use client";

import { useTranslations, useLocale } from "next-intl";
import { Star } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { SearchBox } from "./search-box";

const CATEGORY_TABS = [
  { id: "all", key: "all" },
  { id: "official", key: "official" },
  { id: "media-cn", key: "mediaCn" },
  { id: "media-en", key: "mediaEn" },
  { id: "community", key: "community" },
] as const;

function TabLink({
  tab,
  current,
}: {
  tab: (typeof CATEGORY_TABS)[number];
  current: string;
}) {
  const t = useTranslations("header");
  const active = current === tab.id;
  return (
    <Link
      href={tab.id === "all" ? "/" : `/?category=${tab.id}`}
      className={active ? "active" : undefined}
    >
      {t(tab.key)}
    </Link>
  );
}

function LocaleSwitcher() {
  const locale = useLocale();
  const names: Record<string, string> = {
    en: "EN",
    zh: "中文",
    ja: "日本語",
    es: "ES",
    fr: "FR",
  };
  return (
    <div className="hidden md:flex items-center gap-0.5">
      {Object.entries(names).map(([code, label]) => (
        <Link
          key={code}
          href="/"
          locale={code}
          className={`px-1.5 py-0.5 text-[11px] font-mono rounded transition-colors ${
            code === locale
              ? "text-[#10b981] font-semibold"
              : "text-[#71717a] hover:text-[#f4f4f5]"
          }`}
          aria-current={code === locale ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

export function Header({
  activeCategory,
  q,
}: {
  activeCategory?: string;
  q?: string;
}) {
  const t = useTranslations("header");
  const brand = useTranslations("brand");
  const current = activeCategory ?? "all";
  return (
    <header className="site-header">
      <Link href="/" className="logo-area">
        <span className="logo-pulse" aria-hidden />
        <span className="logo-text">
          {brand("name")} <span>// v2.6 Neo</span>
        </span>
      </Link>

      <nav className="nav-tabs hidden md:flex" aria-label={t("categories")}>
        {CATEGORY_TABS.map((tab) => (
          <TabLink key={tab.id} tab={tab} current={current} />
        ))}
      </nav>

      <div className="header-actions">
        <SearchBox key={q ?? ""} initialQuery={q} />
        <Link
          href="/favorites"
          className="hidden sm:flex items-center justify-center h-8 w-8 rounded-md text-[#71717a] hover:text-[#f4f4f5] transition-colors"
          aria-label={t("favorites")}
        >
          <Star size={16} weight="regular" />
        </Link>
        <LocaleSwitcher />
      </div>
    </header>
  );
}
