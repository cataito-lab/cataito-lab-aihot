import { getTranslations } from "next-intl/server";

/**
 * 数据库不可达时的页内提示。页面仍返回 200 并保留完整 head（title/canonical/hreflang），
 * 避免任何一次数据库抖动都把整站打成 5xx 而击穿收录。
 */
export async function DegradedNote() {
  const t = await getTranslations("site");
  return (
    <div
      role="alert"
      className="mb-6 rounded-md border border-line bg-neon-soft px-4 py-3 text-sm text-fg animate-fade-up"
    >
      {t("dbOutage")}
    </div>
  );
}
