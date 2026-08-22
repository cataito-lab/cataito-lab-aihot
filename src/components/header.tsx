import Link from "next/link";
import { Star } from "@phosphor-icons/react";
import { SearchBox } from "./search-box";
import { ThemeToggle } from "./theme-toggle";
import { PrefsMenu } from "./prefs-menu";

const CATEGORY_TABS = [
  { id: "all", label: "全部" },
  { id: "official", label: "官方" },
  { id: "media-cn", label: "中文媒体" },
  { id: "media-en", label: "英文媒体" },
  { id: "community", label: "社区" },
] as const;

function TabLink({
  tab,
  current,
  className,
}: {
  tab: (typeof CATEGORY_TABS)[number];
  current: string;
  className?: string;
}) {
  const active = current === tab.id;
  return (
    <Link
      href={tab.id === "all" ? "/" : `/?category=${tab.id}`}
      className={`${className ?? ""} px-3 py-1.5 rounded-full text-[13px] whitespace-nowrap transition-colors ${
        active
          ? "bg-fg text-bg font-medium"
          : "text-fg-secondary hover:text-fg"
      }`}
    >
      {tab.label}
    </Link>
  );
}

export function Header({
  activeCategory,
  q,
}: {
  activeCategory?: string;
  q?: string;
}) {
  const current = activeCategory ?? "all";
  return (
    <header className="sticky top-0 z-40 bg-bg/80 backdrop-blur-xl border-b border-line">
      <div className="mx-auto max-w-[680px] px-4 h-14 flex items-center gap-2">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="w-6 h-6 rounded-md brand-gradient-bg flex items-center justify-center" aria-hidden>
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              stroke="#fff"
              strokeWidth="2.4"
              strokeLinecap="round"
              fill="none"
            >
              <circle cx="12" cy="12" r="2.2" fill="#fff" stroke="none" />
              <path d="M8.4 15.6a5.1 5.1 0 0 1 0-7.2" />
              <path d="M15.6 8.4a5.1 5.1 0 0 1 0 7.2" />
            </svg>
          </span>
          <span className="text-[15px] font-bold tracking-tight whitespace-nowrap">
            AI 热点简报
          </span>
        </Link>
        <nav className="hidden lg:flex items-center gap-0.5 ml-auto overflow-x-auto">
          {CATEGORY_TABS.map((tab) => (
            <TabLink key={tab.id} tab={tab} current={current} />
          ))}
        </nav>
        <div className="flex-1 sm:ml-auto" />
        <Link
          href="/favorites"
          className="hidden sm:inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-neon transition-colors h-8 px-2 rounded"
        >
          <Star size={12} weight="regular" />
          收藏
        </Link>
        <PrefsMenu />
        <SearchBox key={q ?? ""} initialQuery={q} />
        <ThemeToggle />
      </div>
    </header>
  );
}
