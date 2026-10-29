import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { pickField, pickSummary } from "@/lib/localize";
import { pickTitle } from "@/lib/i18n";
import { formatRelativeTime, formatScore } from "@/lib/format";
import type { FeedArticle } from "@/lib/types";

function leadHref(article: FeedArticle): string {
  return article.eventKey ? `/event/${article.eventKey}` : article.url;
}

/** 取某条目的「关键变化」（本站 AI 洞察的第一格） */
function pickKeyChange(a: FeedArticle, locale: string): string | null {
  return pickField(
    { zh: a.keyChange, en: a.keyChangeEn, ja: a.keyChangeJa, es: a.keyChangeEs, fr: a.keyChangeFr },
    locale,
  );
}

/** 头条标记：importance ≥ 88 的条目加粗，字号与其他条目一致 */
function rankOf(score: number | null | undefined): string {
  return (score ?? 0) >= 88 ? "fp-card-lead" : "";
}

/** 信源分类 → header 命名空间下的文案 key */
const CAT_KEYS = {
  official: "official",
  "media-cn": "mediaCn",
  "media-en": "mediaEn",
  community: "community",
} as const;

/**
 * 主 Feed：全部有完整 AI 洞察的文章平铺展示，每条给完整三格。
 * 标题字号统一，层次只靠字重区分。
 */
export async function FpFeed({
  items,
  locale,
  eventSourceCounts,
}: {
  items: FeedArticle[];
  locale: string;
  eventSourceCounts: Map<string, number>;
}) {
  const [tArticle, tV2, tFeed, tHeader] = await Promise.all([
    getTranslations("article"),
    getTranslations("v2"),
    getTranslations("feed"),
    getTranslations("header"),
  ]);

  const triples = items.map((a) => {
    const kc = pickKeyChange(a, locale);
    const why = pickField(
      { zh: a.whyItMatters, en: a.whyItMattersEn, ja: a.whyItMattersJa, es: a.whyItMattersEs, fr: a.whyItMattersFr },
      locale,
    );
    const fwd = pickField(
      { zh: a.forwardSignal, en: a.forwardSignalEn, ja: a.forwardSignalJa, es: a.forwardSignalEs, fr: a.forwardSignalFr },
      locale,
    );
    return {
      keyChange: kc,
      why: why,
      fwd: fwd,
    };
  });

  return (
    <div className="fp-feed">
      {items.map((a, i) => {
        const { primary, secondary } = pickTitle(a, locale);
        const lede = pickSummary(a, locale);
        const score = a.importanceScore ?? a.scoreFinal;
        const rank = rankOf(score);
        const href = leadHref(a);
        const internal = Boolean(a.eventKey);
        const n = a.eventId ? eventSourceCounts.get(a.eventId) : undefined;
        const triple = triples[i];

        return (
          <article className={`fp-card ${rank}`} key={a.id}>
            <header className="fp-card-head">
              <div className="fp-card-meta">
                <span className="fp-card-src">{a.sourceName}</span>
                {a.category && a.category in CAT_KEYS && (
                  <span className="fp-card-cat">{tHeader(CAT_KEYS[a.category as keyof typeof CAT_KEYS])}</span>
                )}
                {score != null && <span className="fp-card-score">{formatScore(score, locale)}</span>}
                {n != null && n > 1 && a.eventKey && (
                  <Link href={`/event/${a.eventKey}`} className="fp-card-event">
                    {tV2("eventReports", { n })}
                  </Link>
                )}
                <span className="fp-card-time">{formatRelativeTime(a.publishedAt, locale)}</span>
              </div>
              <h2 className="fp-card-title">
                {internal ? (
                  <Link href={href}>{primary}</Link>
                ) : (
                  <a href={href} target="_blank" rel="noopener noreferrer">{primary}</a>
                )}
              </h2>
              {secondary && <p className="fp-card-orig">{secondary}</p>}
            </header>

            {lede && <p className="fp-card-lede">{lede}</p>}

            {(triple.keyChange || triple.why || triple.fwd) && (
              <div className="fp-card-insight">
                {triple.keyChange && (
                  <div className="fp-ins">
                    <div className="k">{tArticle("insightKeyChange")}</div>
                    <div className="v">{triple.keyChange}</div>
                  </div>
                )}
                {triple.why && (
                  <div className="fp-ins">
                    <div className="k">{tArticle("insightWhy")}</div>
                    <div className="v">{triple.why}</div>
                  </div>
                )}
                {triple.fwd && (
                  <div className="fp-ins">
                    <div className="k">{tArticle("insightForward")}</div>
                    <div className="v">{triple.fwd}</div>
                  </div>
                )}
              </div>
            )}

            <footer className="fp-card-foot">
              <a href={a.url} target="_blank" rel="noopener noreferrer">{tArticle("verify")}</a>
              {internal && <Link href={href}>{tFeed("viewEvent")}</Link>}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
