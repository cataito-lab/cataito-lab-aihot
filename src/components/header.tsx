"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Globe, List, X, Star, Check } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { SearchBox } from "./search-box";
import { ThemeToggle } from "./theme-toggle";

const CATEGORY_TABS = [
  { id: "all", key: "all" },
  { id: "official", key: "official" },
  { id: "media-cn", key: "mediaCn" },
  { id: "media-en", key: "mediaEn" },
  { id: "community", key: "community" },
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

function TabLink({
  tab,
  current,
  className,
  onNavigate,
}: {
  tab: (typeof CATEGORY_TABS)[number];
  current: string;
  className?: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("header");
  const active = current === tab.id;
  return (
    <Link
      href={tab.id === "all" ? "/" : `/?category=${tab.id}`}
      onClick={onNavigate}
      className={className}
      aria-current={active ? "page" : undefined}
    >
      {t(tab.key)}
    </Link>
  );
}

function LocaleMenu() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const ref = useDismiss(close);
  return (
    <div className="relative" ref={ref}>
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
        <div className="absolute right-0 top-9 z-50 w-40 rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)] p-1.5 animate-fade-up">
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

function MobileMenu({
  current,
  open,
  onClose,
}: {
  current: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("header");
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
        className="absolute top-full left-0 right-0 z-[95] border-b border-[var(--border-color)] bg-[var(--bg-base)] px-4 py-3 flex flex-col gap-1"
        aria-label={t("categories")}
      >
        {CATEGORY_TABS.map((tab) => {
          const active = current === tab.id;
          return (
            <TabLink
              key={tab.id}
              tab={tab}
              current={current}
              onNavigate={onClose}
              className={`px-3 py-2.5 rounded-md text-[14px] font-medium transition-colors ${
                active
                  ? "text-[var(--text-primary)] bg-[var(--overlay-active)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-hover)]"
              }`}
            />
          );
        })}
        <Link
          href="/favorites"
          onClick={onClose}
          className="mt-1 px-3 py-2.5 rounded-md text-[14px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--overlay-hover)] transition-colors flex items-center gap-2"
        >
          <Star size={15} />
          {t("favorites")}
        </Link>
      </nav>
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
  const brand = useTranslations("brand");
  const [menuOpen, setMenuOpen] = useState(false);
  const current = activeCategory ?? "all";
  return (
    <header className="site-header">
      <Link href="/" className="logo-area" onClick={() => setMenuOpen(false)}>
        <span className="logo-pulse" aria-hidden />
        <span className="logo-text">
          {brand("name")} <span>{"// v2.6 Neo"}</span>
        </span>
      </Link>

      <nav className="nav-tabs hidden md:flex" aria-label="Categories">
        {CATEGORY_TABS.map((tab) => (
          <TabLink key={tab.id} tab={tab} current={current} />
        ))}
      </nav>

      <div className="header-actions">
        <SearchBox key={q ?? ""} initialQuery={q} />
        <Link
          href="/favorites"
          className="hidden sm:flex items-center justify-center h-8 w-8 rounded-md           text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Favorites"
        >
          <Star size={16} weight="regular" />
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

      <MobileMenu current={current} open={menuOpen} onClose={() => setMenuOpen(false)} />
    </header>
  );
}
