"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import {
  Globe,
  List,
  X,
  BookmarkSimple,
  Check,
  Funnel,
  CaretDown,
} from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { TOPIC_CATEGORIES, topicLabel } from "@/lib/types";
import { SearchBox } from "./search-box";
import { ThemeToggle } from "./theme-toggle";

// 信源分类（渠道维度）：2026-09-05 起收进「信源」按钮浮层，不再占头部导航
const SOURCE_CATEGORIES = [
  { id: "all", key: "all", dot: "" },
  { id: "official", key: "official", dot: "cat-dot-official" },
  { id: "media-cn", key: "mediaCn", dot: "cat-dot-media" },
  { id: "media-en", key: "mediaEn", dot: "cat-dot-media" },
  { id: "community", key: "community", dot: "cat-dot-community" },
] as const;

const LOCALES = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
] as const;

function useDismiss(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return ref;
}

/** 保留 topic / sort / hours，只切换 category（与 TopicBar 的 buildHref 对称） */
function buildCategoryHref(category: string): string {
  const params = new URLSearchParams();
  if (typeof window !== "undefined") {
    const cur = new URLSearchParams(window.location.search);
    const topic = cur.get("topic");
    const sort = cur.get("sort");
    const hours = cur.get("hours");
    if (topic) params.set("topic", topic);
    if (sort) params.set("sort", sort);
    if (hours) params.set("hours", hours);
  }
  if (category !== "all") params.set("category", category);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

function SourceMenu({
  current,
  sourcesCount,
}: {
  current: string;
  sourcesCount?: number;
}) {
  const t = useTranslations("header");
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(close);
  const filtering = current !== "all";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("sources")}
        aria-expanded={open}
        className={`source-btn ${filtering ? "filtering" : ""} ${open ? "open" : ""}`}
      >
        <Funnel size={12} weight="fill" aria-hidden />
        <span>
          {sourcesCount != null ? `${sourcesCount} ` : ""}
          <span className="source-btn-label">{t("sources")}</span>
        </span>
        <CaretDown size={10} weight="bold" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-[101] w-44 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] p-1.5 animate-fade-up">
          {SOURCE_CATEGORIES.map((cat) => {
            const active = current === cat.id;
            return (
              <Link
                key={cat.id}
                href={buildCategoryHref(cat.id)}
                onClick={close}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                  active
                    ? "text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-hover)]"
                }`}
                aria-current={active ? "true" : undefined}
              >
                {cat.dot ? (
                  <span className={`cat-dot ${cat.dot}`} aria-hidden />
                ) : (
                  <span className="cat-dot" aria-hidden />
                )}
                <span className="flex-1">{t(cat.key)}</span>
                {active && <Check size={12} weight="bold" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LocaleMenu() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(close);
  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Language"
        aria-expanded={open}
        className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
          open ? "text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        }`}
      >
        <Globe size={17} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-[101] w-40 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] p-1.5 animate-fade-up">
          {LOCALES.map((l) => {
            const active = l.code === locale;
            return (
              <Link
                key={l.code}
                href="/"
                locale={l.code}
                onClick={close}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-[13px] transition-colors ${
                  active
                    ? "text-[var(--accent)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-hover)]"
                }`}
                aria-current={active ? "true" : undefined}
              >
                {l.label}
                {active && <Check size={12} weight="bold" />}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("header");
  const locale = useLocale();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="md:hidden">
      <div
        className="absolute top-full left-0 right-0 h-[calc(100vh-4rem)] z-[90] bg-[var(--scrim)]"
        onClick={onClose}
        aria-hidden
      />
      <nav
        className="absolute top-full left-0 right-0 z-[101] border-b border-[var(--border-color)] bg-[var(--bg-base)] px-4 py-3 flex flex-col gap-1"
        aria-label={t("favorites")}
      >
        <span className="px-3 pt-1 pb-1 font-mono text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
          {t("language")}
        </span>
        {LOCALES.map((l) => {
          const active = l.code === locale;
          return (
            <Link
              key={l.code}
              href="/"
              locale={l.code}
              onClick={onClose}
              className={`flex items-center justify-between px-3 py-2 rounded-md text-[14px] transition-colors ${
                active
                  ? "text-[var(--accent)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-hover)]"
              }`}
              aria-current={active ? "true" : undefined}
            >
              {l.label}
              {active && <Check size={12} weight="bold" />}
            </Link>
          );
        })}
        <Link
          href="/favorites"
          onClick={onClose}
          className="mt-1 px-3 py-2.5 rounded-md text-[14px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-hover)] transition-colors flex items-center gap-2"
        >
          <BookmarkSimple size={15} />
          {t("favorites")}
        </Link>
      </nav>
    </div>
  );
}

import { CATAITOLogo } from "@/components/cataito-logo";

// 主题筛选 chips（2026-09-05：桌面进头部中央、移动端保留头下方条）
function TopicChips({ activeTopic }: { activeTopic?: string }) {
  const locale = useLocale();
  const t = useTranslations("header");
  const labelFor = (key: string) => topicLabel(key, locale);

  const buildHref = (topic?: string, keepCategory = true) => {
    const params = new URLSearchParams();
    // 保留当前 category / sort（不破坏其它筛选）
    if (typeof window !== "undefined" && keepCategory) {
      const cur = new URLSearchParams(window.location.search);
      const c = cur.get("category");
      const s = cur.get("sort");
      if (c) params.set("category", c);
      if (s) params.set("sort", s);
      const h = cur.get("hours");
      if (h) params.set("hours", h);
    }
    if (topic) params.set("topic", topic);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  };

  return (
    <>
      <Link
        href={buildHref(undefined)}
        className={`topic-chip ${!activeTopic ? "active" : ""}`}
        aria-current={!activeTopic ? "page" : undefined}
      >
        {t("all")}
      </Link>
      {TOPIC_CATEGORIES.map((topic) => (
        <Link
          key={topic}
          href={buildHref(topic)}
          className={`topic-chip ${activeTopic === topic ? "active" : ""}`}
          aria-current={activeTopic === topic ? "page" : undefined}
        >
          {labelFor(topic)}
        </Link>
      ))}
    </>
  );
}

export function Header({
  activeCategory,
  q,
  activeTopic,
  sourcesCount,
}: {
  activeCategory?: string;
  q?: string;
  activeTopic?: string;
  sourcesCount?: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const current = activeCategory ?? "all";
  const t = useTranslations("header");
  return (
    <header className="site-header">
      <Link href="/" className="logo-area" onClick={() => setMenuOpen(false)}>
        <CATAITOLogo width={108} />
      </Link>

      {/* 桌面端：主题分类进头部中央（填充原导航空间）；移动端用头下方条 */}
      <nav
        className="header-topics hidden md:flex"
        aria-label={t("topics")}
      >
        <span className="topic-label" aria-hidden>
          {t("topics")}
        </span>
        <div className="header-topics-scroll no-scrollbar">
          <TopicChips activeTopic={activeTopic} />
        </div>
      </nav>

      <div className="header-actions">
        <SearchBox key={q ?? ""} initialQuery={q} />
        <SourceMenu current={current} sourcesCount={sourcesCount} />
        <Link
          href="/favorites"
          className="hidden sm:flex items-center justify-center h-8 w-8 rounded-md           text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Favorites"
        >
          <BookmarkSimple size={16} weight="regular" />
        </Link>
        <ThemeToggle />
        <LocaleMenu />
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={menuOpen}
          className="md:hidden flex items-center justify-center h-8 w-8 rounded-md           text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
        >
          {menuOpen ? <X size={18} /> : <List size={18} />}
        </button>
      </div>

      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* 移动端：主题横向滚动筛选条（桌面端已进头部中央） */}
      <nav
        aria-label={t("topics")}
        className="topic-bar overflow-x-auto no-scrollbar md:hidden"
      >
        <span className="topic-label" aria-hidden>
          {t("topics")}
        </span>
        <TopicChips activeTopic={activeTopic} />
      </nav>
    </header>
  );
}
