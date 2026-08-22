"use client";

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
      aria-label={isDark ? "切换到亮色模式" : "切换到暗色模式"}
      className="w-8 h-8 flex items-center justify-center rounded-full text-fg-secondary hover:text-fg hover:bg-line/50 transition-colors cursor-pointer"
    >
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
