"use client";

import { useTranslations, useLocale } from "next-intl";
import type { BriefMeta } from "@/lib/types";
import { useMounted } from "@/lib/use-mounted";

interface Props {
  meta: BriefMeta;
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

export function BriefingPanel({ meta }: Props) {
  const t = useTranslations("briefing");
  const locale = useLocale();
  const mounted = useMounted();

  return (
    <section className="hero-section animate-fade-up">
      <span className="signal-tag">{t("signal")}</span>
      <h1>
        {t("title")} <span>{t("titleAccent")}</span>
      </h1>
      <p className="hero-desc">{t("lead")}</p>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">{t("updated")}</div>
          <div className="stat-value">
            {mounted ? fmtClock(meta.updatedAt, locale) : "—"}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("last24h")}</div>
          <div className="stat-value">{meta.last24h}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("total")}</div>
          <div className="stat-value">{meta.total}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("sources")}</div>
          <div className="stat-value">{meta.sourcesEnabled}</div>
        </div>
      </div>

      <div className="mt-4 font-mono text-[11px]">
        <a
          href={`/${locale}/daily${meta.updatedAt ? `/${meta.updatedAt.slice(0, 10)}` : ""}`}
          className="text-accent hover:underline"
        >
          {"// "}
          {t("dailyLink")}
        </a>
      </div>
    </section>
  );
}
