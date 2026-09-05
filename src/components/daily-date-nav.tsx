"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { CalendarBlank } from "@phosphor-icons/react";

interface DailyDate {
  date: string;
  count: number;
}

/** 每日简报归档页的日期直达：归档下拉框 + 自由日期输入 + 最新一天快捷键 */
export function DailyDateNav({ dates }: { dates: DailyDate[] }) {
  const t = useTranslations("daily");
  const router = useRouter();
  const [value, setValue] = useState("");
  const latest = dates[0]?.date;

  const go = (date: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) router.push(`/daily/${date}`);
  };

  return (
    <div className="daily-date-nav">
      <div className="daily-date-select">
        <CalendarBlank size={14} aria-hidden />
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) go(e.target.value);
          }}
          aria-label={t("pickDate")}
        >
          <option value="" disabled>
            {t("pickDate")}
          </option>
          {dates.map((d) => (
            <option key={d.date} value={d.date}>
              {d.date} · {t("itemsCount", { n: d.count })}
            </option>
          ))}
        </select>
      </div>
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
    </div>
  );
}
