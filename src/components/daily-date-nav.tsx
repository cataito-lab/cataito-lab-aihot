"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { CalendarBlank, CaretLeft, CaretRight } from "@phosphor-icons/react";

interface DailyDate {
  date: string;
  count: number;
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * 每日简报日期导航：归档下拉框（现有档期）+ 前后日箭头 + 「今天」+ 自由日期输入。
 * - 归档索引页（无 current）：下拉框 + 今天 + 自由输入
 * - 单日页（有 current）：额外显示前后日箭头与存档入口，下拉框定位到当前日期
 */
export function DailyDateNav({ dates, current }: { dates: DailyDate[]; current?: string }) {
  const t = useTranslations("daily");
  const locale = useLocale();
  const router = useRouter();
  const [value, setValue] = useState("");
  const latest = dates[0]?.date;
  const inList = Boolean(current && dates.some((d) => d.date === current));

  const go = (date: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) router.push(`/daily/${date}`);
  };

  return (
    <div className="daily-date-nav">
      {current && (
        <button
          type="button"
          className="daily-today-btn"
          onClick={() => go(shiftDate(current, -1))}
          aria-label={t("prevDay")}
        >
          <CaretLeft size={12} weight="bold" aria-hidden />
        </button>
      )}
      <div className="daily-date-select">
        <CalendarBlank size={14} aria-hidden />
        <select
          value={inList ? current : ""}
          onChange={(e) => {
            if (e.target.value) go(e.target.value);
          }}
          aria-label={t("pickDate")}
        >
          {!inList && (
            <option value="" disabled>
              {current ?? t("pickDate")}
            </option>
          )}
          {dates.map((d) => (
            <option key={d.date} value={d.date}>
              {d.date} · {t("itemsCount", { n: d.count })}
            </option>
          ))}
        </select>
      </div>
      {current && (
        <button
          type="button"
          className="daily-today-btn"
          onClick={() => go(shiftDate(current, 1))}
          aria-label={t("nextDay")}
        >
          <CaretRight size={12} weight="bold" aria-hidden />
        </button>
      )}
      {latest && (
        <button type="button" className="daily-today-btn" onClick={() => go(latest)}>
          {t("today")}
        </button>
      )}
      <div className="daily-date-input">
        <input
          type="date"
          value={value}
          max={latest}
          onChange={(e) => {
            setValue(e.target.value);
            if (e.target.value) go(e.target.value);
          }}
          aria-label={t("pickDate")}
        />
      </div>
      {current && (
        <a className="daily-archive-link" href={`/${locale}/daily`}>
          {t("archive")}
        </a>
      )}
    </div>
  );
}
