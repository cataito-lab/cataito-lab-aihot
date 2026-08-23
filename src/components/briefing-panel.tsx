"use client";

import { useTranslations, useLocale } from "next-intl";
import type { BriefMeta } from "@/lib/types";

interface Props {
  meta: BriefMeta;
  activeCategories: string[];
}

function fmtClock(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function catLabel(locale: string, id: string): string {
  const map: Record<string, string> = {
    official: locale === "zh" ? "官方" : "Official",
    "media-cn": locale === "zh" ? "中文媒体" : "CN Media",
    "media-en": locale === "zh" ? "英文媒体" : "EN Media",
    community: locale === "zh" ? "社区" : "Community",
  };
  return map[id] ?? id;
}

export function BriefingPanel({ meta, activeCategories }: Props) {
  const t = useTranslations("briefing");
  const locale = useLocale();
  const covered = meta.categoryCounts.filter((c) => c.count > 0);

  return (
    <section className="relative py-6 sm:py-10 animate-fade-up">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-neon mb-3 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-neon shadow-[0_0_10px_currentColor]" />
        </span>
        {t("signal")}
      </p>

      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[40px] sm:text-[52px] font-black tracking-[-0.04em] leading-[1.02]">
            {t("title")} <span className="text-fg-muted">{t("titleAccent")}</span>
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-fg-secondary max-w-[54ch]">
            {t("lead")}
          </p>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-2.5 font-mono">
        <div className="rounded-xl border border-line bg-surface/60 px-4 py-3.5 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]">
          <div className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">{t("updated")}</div>
          <div className="mt-1.5 tabular-nums text-[20px] font-semibold text-fg" suppressHydrationWarning>
            {fmtClock(meta.updatedAt, locale)}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface/60 px-4 py-3.5 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]">
          <div className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">{t("last24h")}</div>
          <div className="mt-1.5 tabular-nums text-[20px] font-semibold text-neon">{meta.last24h}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface/60 px-4 py-3.5 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]">
          <div className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">{t("total")}</div>
          <div className="mt-1.5 tabular-nums text-[20px] font-semibold text-fg">{meta.total}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface/60 px-4 py-3.5 shadow-[0_1px_0_rgba(255,255,255,0.02)_inset]">
          <div className="text-[10px] uppercase tracking-[0.1em] text-fg-muted">{t("sources")}</div>
          <div className="mt-1.5 tabular-nums text-[20px] font-semibold text-fg">{meta.sourcesEnabled}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-fg-muted">
        <span className="uppercase tracking-[0.08em]">{t("covered")}</span>
        {covered.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={`w-1 h-1 rounded-full ${activeCategories.length === 0 || activeCategories.includes(c.id) ? "bg-neon" : "bg-fg-muted/40"}`} />
            {catLabel(locale, c.id)}
            <span className="font-mono tabular-nums">{c.count}</span>
          </span>
        ))}
      </div>
    </section>
  );
}