import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { getDailyDates } from "@/lib/news";
import { formatNumber, intlLocale } from "@/lib/format";

/**
 * 左栏：历史归档（最近 30 天有内容的日期 + 条数），链接到 /daily/[date]。
 * 数据来自 news.ts getDailyDates，纯读取，不涉及评分与排序逻辑。
 */
export async function FpArchive({ locale }: { locale: string }) {
  const [tDaily, dates] = await Promise.all([
    getTranslations({ locale, namespace: "daily" }),
    getDailyDates(30),
  ]);
  if (dates.length === 0) return null;

  // 归档按 UTC 日期切分，格式化时固定 UTC，避免访客时区把日期串到前一天
  const fmt = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

  return (
    <section className="fp-archive">
      <div className="fp-sec-hd">
        <span className="l">{tDaily("archive")}</span>
      </div>
      <ol className="fp-archive-list">
        {dates.map((d) => (
          <li key={d.date}>
            <Link href={`/daily/${d.date}`} className="fp-archive-item">
              <span className="d">
                {fmt.format(new Date(`${d.date}T00:00:00Z`))}
              </span>
              <span className="n">{formatNumber(d.count, locale)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
