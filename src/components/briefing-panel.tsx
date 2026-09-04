"use client";

import { useTranslations, useLocale } from "next-intl";
import type { BriefMeta } from "@/lib/types";
import { useMounted } from "@/lib/use-mounted";
import { formatNumber, formatCompactNumber } from "@/lib/format";

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
        {/* TODO(aaron 2026-09-03): 下架"数据更新于"卡片。
            根因：fetch_logs.finished_at 长期为 null —— pipeline 单轮耗时 45-60 分钟，
            而 workflow timeout-minutes 一直设置得不够（经历过 10/20/45 三次上调），
            导致每一轮 run 都在 finishRun() 之前被掐掉，ok 和 finished_at 永远写不进去。
            当前状态：已确认 GitHub Actions 层并发配置（cancel-in-progress=false + group:news-pipeline）
            和 timeout=90min 已生效，但 CF Workers 侧 aihot-news-scheduler 的 Cron 删不干净、
            还在 10 分钟频率 dispatch，持续制造 contention。
            恢复条件：① CF Workers 后台 aihot-news-scheduler 的 Cron Trigger 彻底停用
            （删除 Cron 条目或 Pause Worker）；② 远端 fetch_logs 出现连续 ≥2 条 ok=1 的记录；
            ③ 本地 node diag_clock.mjs 查到最近 ok 记录距今 <30 分钟。
            届时直接注释块恢复、删 TODO 即可。 */}
        <div className="stat-card">
          <div className="stat-label">{t("last24h")}</div>
          <div className="stat-value">{formatNumber(meta.last24h, locale)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("total")}</div>
          <div className="stat-value">{formatCompactNumber(meta.total, locale)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">{t("sources")}</div>
          <div className="stat-value">{formatNumber(meta.sourcesEnabled, locale)}</div>
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
