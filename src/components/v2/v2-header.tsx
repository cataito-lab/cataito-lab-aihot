"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Check } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ThemeToggle } from "../theme-toggle";
import { routing } from "@/i18n/routing";

const LOCALE_LABELS: Record<string, string> = {
  en: "English",
  zh: "中文",
  ja: "日本語",
  es: "Español",
  fr: "Français",
};

/** V1 同款的点击外部/Escape 关闭 hook */
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

export function V2Header() {
  const t = useTranslations("v2");
  const tBrand = useTranslations("brand");
  const locale = useLocale();
  const [langOpen, setLangOpen] = useState(false);
  const closeLang = () => setLangOpen(false);
  const langRef = useDismiss(closeLang);

  return (
    <header className="v2-header">
      <Link href="/" className="v2-brand">
        {tBrand("name")}
        <span className="v2-badge">{t("badge")}</span>
      </Link>
      <div className="v2-header-actions">
        <div className="v2-lang-wrap" ref={langRef}>
          <button
            type="button"
            onClick={() => setLangOpen((v) => !v)}
            aria-label={t("language")}
            aria-expanded={langOpen}
            className={`v2-icon-btn ${langOpen ? "is-active" : ""}`}
          >
            <Globe size={17} />
          </button>
          {langOpen && (
            <div className="v2-lang-menu" role="menu">
              {routing.locales.map((l) => {
                const active = l === locale;
                return (
                  <Link
                    key={l}
                    href="/v2"
                    locale={l}
                    onClick={closeLang}
                    className="v2-lang-item"
                    data-active={active}
                    aria-current={active ? "true" : undefined}
                    role="menuitem"
                  >
                    <span>{LOCALE_LABELS[l] ?? l}</span>
                    {active && <Check size={12} weight="bold" />}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        <ThemeToggle />
        <Link href="/" className="v2-link-ghost">
          {t("backToClassic")}
        </Link>
      </div>
    </header>
  );
}
