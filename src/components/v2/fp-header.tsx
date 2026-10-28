"use client";

import { useEffect, useRef, useState } from "react";
import { Globe, Check, Rss } from "@phosphor-icons/react";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ThemeToggle } from "../theme-toggle";
import { routing } from "@/i18n/routing";
import { useMounted } from "@/lib/use-mounted";
import { intlLocale } from "@/lib/format";

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

/** 头版 masthead：报头站名 + 定位语 + 访客本地日期（客户端渲染避免 hydration 不一致） */
export function FpHeader({ statsLine }: { statsLine: string }) {
  const t = useTranslations("v2");
  const tBrand = useTranslations("brand");
  const locale = useLocale();
  const mounted = useMounted();
  const [langOpen, setLangOpen] = useState(false);
  const closeLang = () => setLangOpen(false);
  const langRef = useDismiss(closeLang);

  const dateLine = mounted
    ? new Intl.DateTimeFormat(intlLocale(locale), {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date())
    : "";

  return (
    <header className="fp-mast">
      <div className="fp-mast-row">
        <Link href="/v2" className="fp-brand">
          {tBrand("name")}
        </Link>
        <span className="fp-badge">{t("badge")}</span>
        <div className="fp-mast-actions">
          <div className="fp-lang-wrap" ref={langRef}>
            <button
              type="button"
              onClick={() => setLangOpen((v) => !v)}
              aria-label={t("language")}
              aria-expanded={langOpen}
              className={`fp-icon-btn ${langOpen ? "is-active" : ""}`}
            >
              <Globe size={17} />
            </button>
            {langOpen && (
              <div className="fp-lang-menu" role="menu">
                {routing.locales.map((l) => {
                  const active = l === locale;
                  return (
                    <Link
                      key={l}
                      href="/v2"
                      locale={l}
                      onClick={closeLang}
                      className="fp-lang-item"
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
          <a href="/rss.xml" className="fp-icon-btn" aria-label="RSS">
            <Rss size={16} />
          </a>
          <ThemeToggle />
          <Link href="/" className="fp-link-ghost">
            {t("backToClassic")}
          </Link>
        </div>
      </div>
      <div className="fp-mast-sub">
        <span className="fp-tagline">{t("tagline")}</span>
        <span>{statsLine}</span>
        <span className="fp-mast-date" suppressHydrationWarning>
          {dateLine}
        </span>
      </div>
      <hr className="fp-rule-dbl" />
    </header>
  );
}
