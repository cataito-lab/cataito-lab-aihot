"use client";

import { useTranslations, useLocale } from "next-intl";
import { RadarDisc } from "./radar-disc";
import type { BriefMeta } from "@/lib/types";

interface Props {
  meta: BriefMeta;
  activeCategories: string[];
}

function fmtClock(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
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
    <section className="relative pt-12 pb-8 animate-fade-up">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-neon mb-3 flex items-center gap-2">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-neon opacity-60" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neon" />
            </span>
            {t("signal")}
          </p>
          <h1 className="text-[42px] sm:text-[54px] font-black tracking-[-0.045em] leading-[1.02]">
            {t("title")} <span className="brand-gradient-text">{t("titleAccent")}</span>
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-fg-secondary max-w-[46ch]">
            {t("lead")}
          </p>
        </div>
        <div className="hidden sm:block pt-2 opacity-90">
          <RadarDisc size={168} />
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
        <div className="rounded-lg border border-line bg-surface/60 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">{t("updated")}</div>
          <div className="mt-1 tabular-nums text-fg" suppressHydrationWarning>
            {fmtClock(meta.updatedAt, locale)}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface/60 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">{t("last24h")}</div>
          <div className="mt-1 tabular-nums text-neon">{meta.last24h}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface/60 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">{t("total")}</div>
          <div className="mt-1 tabular-nums text-fg">{meta.total}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface/60 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-fg-muted">{t("sources")}</div>
          <div className="mt-1 tabular-nums text-fg">{meta.sourcesEnabled}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-fg-muted">
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