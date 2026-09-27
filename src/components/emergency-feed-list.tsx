import { getTranslations } from "next-intl/server";
import { formatRelativeTime } from "@/lib/format";
import { emergencyGeneratedAt, type EmergencyItem } from "@/lib/emergency-feed";

/**
 * 应急时间线：数据库读不到时，用构建时抓取的信源快照兜底。
 * 只有标题/信源/链接/时间——AI 洞察与 5 语言摘要只存在于库里，这里没有。
 */
export async function EmergencyFeedList({
  items,
  locale,
}: {
  items: EmergencyItem[];
  locale: string;
}) {
  const t = await getTranslations("emergency");
  const generatedAt = emergencyGeneratedAt();
  return (
    <section className="animate-fade-up">
      <p className="mb-3 font-mono text-[11px] text-fg-muted">
        {t("note")}
        {generatedAt ? ` · ${t("generated", { time: formatRelativeTime(generatedAt, locale) })}` : ""}
      </p>
      <ul className="feed-list">
        {items.map((a) => (
          <li key={a.id} className="card px-4 py-3">
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="font-medium leading-snug hover:text-accent transition-colors"
            >
              {a.title}
            </a>
            <p className="mt-1.5 font-mono text-[11px] text-fg-muted">
              {a.sourceName} · {formatRelativeTime(a.publishedAt, locale)}
            </p>
            {a.excerpt && (
              <p className="mt-1.5 text-sm text-fg-muted leading-relaxed">{a.excerpt}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
