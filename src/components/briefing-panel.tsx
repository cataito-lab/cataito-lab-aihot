"use client";

import { useTranslations, useLocale } from "next-intl";
import { CalendarBlank } from "@phosphor-icons/react";
import type { BriefMeta } from "@/lib/types";
import { formatNumber, formatCompactNumber } from "@/lib/format";

interface Props {
  meta: BriefMeta;
}

export function BriefingPanel({ meta }: Props) {
  const t = useTranslations("briefing");
  const locale = useLocale();

  return (
    <section className="hero-section animate-fade-up">
      <div className="hero-row">
        <h1>
          {t("title")} <span>{t("titleAccent")}</span>
        </h1>
        <p className="hero-stats">
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
              届时在此行内追加「数据更新于 HH:mm」即可（2026-09-05 hero 压缩后原独立时钟卡片
              与 fmtClock 工具函数已随压缩移除）。 */}
          <span className="stat-item">
            <b>{formatNumber(meta.last24h, locale)}</b> {t("last24h")}
          </span>
          <span className="stat-sep" aria-hidden>
            ·
          </span>
          <span className="stat-item">
            <b>{formatCompactNumber(meta.total, locale)}</b> {t("total")}
          </span>
          <span className="stat-sep" aria-hidden>
            ·
          </span>
          <span className="stat-item">
            <b>{formatNumber(meta.sourcesEnabled, locale)}</b> {t("sources")}
          </span>
        </p>
        <a
          href={`/${locale}/daily${meta.updatedAt ? `/${meta.updatedAt.slice(0, 10)}` : ""}`}
          className="hero-daily"
        >
          <CalendarBlank size={14} aria-hidden />
          {t("dailyLink")}
        </a>
      </div>
    </section>
  );
}
