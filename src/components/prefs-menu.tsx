"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, Check } from "@phosphor-icons/react";
import { PREFS_COOKIE, readPrefsFromCookie, savePrefsCookie } from "@/lib/prefs";

function subscribe(cb: () => void): () => void {
  window.addEventListener(PREFS_COOKIE, cb);
  return () => window.removeEventListener(PREFS_COOKIE, cb);
}

function getSnapshot(): string[] {
  return readPrefsFromCookie();
}

function getServerSnapshot(): string[] {
  return [];
}

const CATEGORY_IDS = ["official", "media-cn", "media-en", "community"] as const;

function catLabel(locale: string, id: string): string {
  const map: Record<string, string> = {
    official: "official",
    "media-cn": locale === "zh" ? "中文媒体" : "CN Media",
    "media-en": locale === "zh" ? "英文媒体" : "EN Media",
    community: locale === "zh" ? "社区" : "Community",
  };
  return map[id] ?? id;
}

export function PrefsMenu() {
  const t = useTranslations("prefs");
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const selected = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggleOpen = () => {
    if (!open) setDraft(selected);
    setOpen((v) => !v);
  };

  const toggle = (id: string) => setDraft((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const apply = (cats: string[]) => {
    savePrefsCookie(cats);
    setOpen(false);
    router.refresh();
  };

  const activeCount = selected.length;

  return (
    <div className="relative" ref={panelRef}>
      <button type="button" onClick={toggleOpen} aria-expanded={open} aria-label={t("aria")} className={`h-8 pl-2.5 pr-3 inline-flex items-center gap-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${open || activeCount > 0 ? "border-accent/60 text-accent bg-neon-soft/60" : "border-line text-fg-secondary hover:text-fg hover:border-fg-muted/40"}`}>
        <SlidersHorizontal size={13} />
        {t("label")}
        {activeCount > 0 && (
          <span className="font-mono text-[10px] px-1 rounded bg-accent text-white">{activeCount}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-56 rounded-xl border border-line bg-surface shadow-2xl p-2 animate-fade-up">
          <p className="px-2 py-1.5 text-[11px] uppercase tracking-[0.08em] text-fg-muted">{t("header")}</p>
          {CATEGORY_IDS.map((id) => {
            const checked = draft.includes(id);
            return (
              <button key={id} type="button" onClick={() => toggle(id)} aria-pressed={checked} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-[13px] text-fg hover:bg-line/50 transition-colors cursor-pointer">
                <span className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${checked ? "bg-accent border-accent text-white" : "border-fg-muted/40"}`}>
                  {checked && <Check size={11} weight="bold" />}
                </span>
                {catLabel(locale, id)}
              </button>
            );
          })}
          <div className="mt-1 pt-1 border-t border-line flex gap-2">
            <button type="button" onClick={() => apply([])} className="flex-1 py-1.5 rounded-lg text-xs text-fg-secondary hover:bg-line/50 transition-colors cursor-pointer">
              {t("all")}
            </button>
            <button type="button" onClick={() => apply(draft)} disabled={draft.length === 0} aria-label={t("applyAria")} className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-accent text-white disabled:opacity-40 hover:opacity-90 transition-opacity cursor-pointer">
              {t("apply")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}