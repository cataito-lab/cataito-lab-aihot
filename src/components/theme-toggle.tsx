"use client";

import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { Moon, Sun } from "@phosphor-icons/react";

function subscribeTheme(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getThemeSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

function getServerThemeSnapshot(): boolean {
  return false;
}

export function ThemeToggle() {
  const t = useTranslations("header");
  const isDark = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot,
  );

  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? t("light") : t("dark")}
      className="w-8 h-8 flex items-center justify-center rounded-full text-fg-secondary hover:text-fg hover:bg-line/50 transition-colors cursor-pointer"
    >
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}