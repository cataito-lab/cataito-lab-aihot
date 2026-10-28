import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { pickField, pickSummary } from "@/lib/localize";
import { pickTitle } from "@/lib/i18n";
import { formatRelativeTime, formatScore } from "@/lib/format";
import type { FeedArticle } from "@/lib/types";

function leadHref(article: FeedArticle): string {
  return article.eventKey ? `/event/${article.eventKey}` : article.url;
}

/** 头条：近 48h 重要度最高的一条（事件级，含综合摘要与双栏洞察） */
export async function FpLead({
  article,
  locale,
  eventSources,
}: {
  article: FeedArticle;
  locale: string;
  eventSources?: number;
}) {
  const tV2 = await getTranslations("v2");
  const tArticle = await getTranslations("article");

  const { primary, secondary } = pickTitle(article, locale);
  const lede = pickSummary(article, locale);
  const keyChange = pickField(
    { zh: article.keyChange, en: article.keyChangeEn, ja: article.keyChangeJa, es: article.keyChangeEs, fr: article.keyChangeFr },
    locale,
  );
  const whyItMatters = pickField(
    { zh: article.whyItMatters, en: article.whyItMattersEn, ja: article.whyItMattersJa, es: article.whyItMattersEs, fr: article.whyItMattersFr },
    locale,
  );
  const forwardSignal = pickField(
    { zh: article.forwardSignal, en: article.forwardSignalEn, ja: article.forwardSignalJa, es: article.forwardSignalEs, fr: article.forwardSignalFr },
    locale,
  );
  const insights = [
    { label: tArticle("insightKeyChange"), text: keyChange },
    { label: tArticle("insightWhy"), text: whyItMatters },
    { label: tArticle("insightForward"), text: forwardSignal },
  ].filter((x) => x.text);

  const href = leadHref(article);
  const internal = Boolean(article.eventKey);

  return (
    <section className="fp-lead">
      <div className="fp-lead-eyebrow">
        <span>{tV2("lead")}</span>
        <span className="dim">
          {eventSources != null && eventSources > 1
            ? tV2("eventReports", { n: eventSources })
            : article.sourceName}
          {" · "}
          {formatRelativeTime(article.publishedAt, locale)}
        </span>
      </div>
      <h1 className="fp-lead-title">
        {internal ? (
          <Link href={href}>{primary}</Link>
        ) : (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {primary}
          </a>
        )}
      </h1>
      {secondary && <p className="fp-lead-orig">{secondary}</p>}
      {lede && <p className="fp-lead-lede">{lede}</p>}
      {insights.length > 0 && (
        <div className="fp-lead-insight">
          {insights.map((x) => (
            <div className="fp-ins" key={x.label}>
              <div className="k">{x.label}</div>
              <div className="v">{x.text}</div>
            </div>
          ))}
        </div>
      )}
      <div className="fp-lead-foot">
        <span>{article.sourceName}</span>
        {eventSources != null && eventSources > 1 && article.eventKey && (
          <Link href={`/event/${article.eventKey}`}>
            {tV2("eventReports", { n: eventSources })}
          </Link>
        )}
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          {tArticle("verify")}
        </a>
      </div>
    </section>
  );
}

/** 要闻：编号列表（02 起），近 48h 重要度次之条目 */
export async function FpBriefs({
  items,
  locale,
}: {
  items: FeedArticle[];
  locale: string;
}) {
  const tV2 = await getTranslations("v2");
  if (items.length === 0) return null;

  return (
    <section>
      <div className="fp-sec-hd">
        <span className="l">{tV2("briefsTitle")}</span>
        <span className="r">{tV2("briefsSubtitle")}</span>
      </div>
      <ol className="fp-briefs">
        {items.map((a, i) => {
          const { primary } = pickTitle(a, locale);
          const score = a.importanceScore ?? a.scoreFinal;
          const href = leadHref(a);
          const internal = Boolean(a.eventKey);
          return (
            <li className="fp-brief" key={a.id}>
              <span className="fp-brief-rank">{String(i + 1).padStart(2, "0")}</span>
              <div className="fp-brief-body">
                <div className="fp-brief-title">
                  {internal ? (
                    <Link href={href}>{primary}</Link>
                  ) : (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {primary}
                    </a>
                  )}
                </div>
                <div className="fp-brief-meta">
                  {a.sourceName} · {formatRelativeTime(a.publishedAt, locale)}
                  {score != null && (
                    <>
                      {" · "}
                      <span className="sc">{formatScore(score, locale)}</span>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
