import { getTranslations } from "next-intl/server";
import { FpHeader } from "@/components/v2/fp-header";
import { getBriefMeta } from "@/lib/news";
import { formatNumber, formatRelativeTime } from "@/lib/format";
import "../../fp.css";

export default async function V2Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [meta, tBriefing, tHome] = await Promise.all([
    getBriefMeta(),
    getTranslations("briefing"),
    getTranslations("home"),
  ]);

  const statsLine = [
    meta.updatedAt
      ? `${tBriefing("updated")} ${formatRelativeTime(meta.updatedAt, locale)}`
      : null,
    `${formatNumber(meta.last24h, locale)} ${tBriefing("last24h")}`,
    `${formatNumber(meta.sourcesEnabled, locale)} ${tBriefing("sources")}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="fp-root">
      <FpHeader statsLine={statsLine} />
      {children}
      <footer className="fp-foot">
        {tHome("footerBrand")}
        {tHome("footerNote")}
        {tHome("footerSource")}
      </footer>
    </div>
  );
}
