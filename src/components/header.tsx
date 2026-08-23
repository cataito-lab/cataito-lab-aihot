"use client";

import { useTranslations, useLocale } from "next-intl";
import { GlobeHemisphereWest, Star } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { SearchBox } from "./search-box";
import { ThemeToggle } from "./theme-toggle";
import { PrefsMenu } from "./prefs-menu";

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
      className={`px-2.5 py-1 text-[13px] whitespace-nowrap transition-colors ${
        active ? "text-fg font-semibold" : "text-fg-muted hover:text-fg"
      }`}
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
    <div className="hidden sm:flex items-center gap-0.5">
      {Object.entries(names).map(([code, label]) => (
        <Link
          key={code}
          href={code === locale ? "/" : "/"}
          locale={code}
          className={`px-1.5 py-0.5 text-[11px] font-mono rounded transition-colors ${
            code === locale ? "text-accent font-semibold" : "text-fg-muted hover:text-fg"
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
  const current = activeCategory ?? "all";
  return (
    <header className="sticky top-0 z-40 bg-bg/80 backdrop-blur-xl border-b border-line">
      <div className="mx-auto max-w-[680px] px-4 h-14 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="w-6 h-6 rounded-md brand-gradient-bg flex items-center justify-center" aria-hidden>
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none">
              <circle cx="12" cy="12" r="2.2" fill="#fff" stroke="none" />
              <path d="M8.4 15.6a5.1 5.1 0 0 1 0-7.2" />
              <path d="M15.6 8.4a5.1 5.1 0 0 1 0 7.2" />
            </svg>
          </span>
          <span className="text-[15px] font-bold tracking-tight whitespace-nowrap">AI Hot Takes</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1 ml-1">
          {CATEGORY_TABS.map((tab) => (
            <TabLink key={tab.id} tab={tab} current={current} />
          ))}
        </nav>

        <div className="flex-1" />

        <SearchBox key={q ?? ""} initialQuery={q} />

        <Link
          href="/favorites"
          className="hidden sm:flex items-center justify-center h-8 w-8 rounded-lg text-fg-secondary hover:text-fg hover:bg-line/50 transition-colors"
          aria-label={t("favorites")}
        >
          <Star size={16} weight="regular" />
        </Link>

        <ThemeToggle />
        <LocaleSwitcher />
        <PrefsMenu />
      </div>
    </header>
  );
}