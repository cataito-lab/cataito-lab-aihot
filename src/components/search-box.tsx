"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { MagnifyingGlass, X } from "@phosphor-icons/react";

export function SearchBox({ initialQuery = "" }: { initialQuery?: string }) {
  const t = useTranslations("header");
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [prevUrlQ, setPrevUrlQ] = useState(initialQuery);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (initialQuery !== prevUrlQ) {
    setPrevUrlQ(initialQuery);
    setValue(initialQuery);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = (q: string) => {
    const url = q.trim() ? `/?q=${encodeURIComponent(q.trim())}` : "/";
    router.push(url);
  };

  const onChange = (next: string) => {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => navigate(next), 400);
  };

  return (
    <div className="search-shortcut">
      <MagnifyingGlass size={13} aria-hidden />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (timerRef.current) clearTimeout(timerRef.current);
            navigate(value);
          }
        }}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchAria")}
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            setValue("");
            if (timerRef.current) clearTimeout(timerRef.current);
            navigate("");
            inputRef.current?.focus();
          }}
          aria-label={t("searchAria")}
          className="flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
