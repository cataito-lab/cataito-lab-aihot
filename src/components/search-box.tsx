"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlass, X } from "@phosphor-icons/react";

export function SearchBox({ initialQuery = "" }: { initialQuery?: string }) {
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
    <div className="relative w-36 sm:w-52">
      <MagnifyingGlass
        size={14}
        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none"
      />
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
        placeholder="搜索 ⌘K"
        aria-label="搜索新闻标题"
        className="w-full h-9 pl-8 pr-7 rounded-xl border border-line bg-surface/70 text-[13px] placeholder:text-fg-muted outline-none focus:border-accent/50 focus:ring-4 focus:ring-accent/10 focus:bg-surface transition-all"
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
          aria-label="清除搜索"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-fg-muted hover:text-fg cursor-pointer"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
