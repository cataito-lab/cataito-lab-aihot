"use client";

import { useTranslations } from "next-intl";
import { useMounted } from "@/lib/use-mounted";

/** 访客本地 UTC 偏移标签，如 "UTC+8"、"UTC+5:30"、"UTC-3" */
function localOffsetLabel(): string {
  const min = -new Date().getTimezoneOffset();
  const sign = min < 0 ? "-" : "+";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** 页脚提示：告知访客全站时间已按其本地时区渲染。挂载后才输出（偏移量只有客户端知道）。 */
export function TzNote() {
  const t = useTranslations("footer");
  const mounted = useMounted();
  return (
    <p className="mt-2 text-center font-mono text-[11px] text-fg-muted">
      {mounted ? `${t("tzNote")} · ${localOffsetLabel()}` : ""}
    </p>
  );
}
