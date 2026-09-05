"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { CalendarBlank } from "@phosphor-icons/react";

/** 每日简报归档页的日期直达：原生日期选择器 + 最新一天快捷键 */
export function DailyDateNav({ latest }: { latest?: string }) {
  const t = useTranslations("daily");
  const router = useRouter();
  const [value, setValue] = useState("");

  const go = (date: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) router.push(`/daily/${date}`);
  };

  return (
    <div className="daily-date-nav">
      <div className="daily-date-input">
        <CalendarBlank size={14} aria-hidden />
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
      {latest && (
        <button type="button" className="daily-today-btn" onClick={() => go(latest)}>
          {t("today")}
        </button>
      )}
    </div>
  );
}
