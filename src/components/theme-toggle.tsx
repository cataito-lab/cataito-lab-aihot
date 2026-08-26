"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor } from "@phosphor-icons/react";

type Theme = "light" | "dark" | "system";

const ORDER: Theme[] = ["light", "dark", "system"];

function systemTheme(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(t: Theme) {
  try {
    localStorage.setItem("theme", t);
  } catch {
    /* localStorage 不可用时忽略 */
  }
  document.documentElement.setAttribute("data-theme", t === "system" ? systemTheme() : t);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("theme");
    } catch {
      /* ignore */
    }
    if (stored === "light" || stored === "dark" || stored === "system") {
      setTheme(stored);
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      let current: string | null = null;
      try {
        current = localStorage.getItem("theme");
      } catch {
        /* ignore */
      }
      if (current === "system" || !current) {
        document.documentElement.setAttribute("data-theme", systemTheme());
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(next);
    applyTheme(next);
  };

  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  const label = theme === "light" ? "Light" : theme === "dark" ? "Dark" : "System";

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${label}`}
      title={label}
      className="flex items-center justify-center h-8 w-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
    >
      <Icon size={17} />
    </button>
  );
}
