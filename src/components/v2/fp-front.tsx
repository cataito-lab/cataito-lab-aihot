import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { pickField, pickSummary } from "@/lib/localize";
import { pickTitle } from "@/lib/i18n";
import { formatRelativeTime, formatScore } from "@/lib/format";
import type { FeedArticle } from "@/lib/types";

function leadHref(article: FeedArticle): string {
  return article.eventKey ? `/event/${article.eventKey}` : article.url;
}

/** 取某条目的「关键变化」摘录（本站 AI 洞察的第一格，信息密度最高） */
function pickKeyChange(a: FeedArticle, locale: string): string | null {
  return pickField(
    { zh: a.keyChange, en: a.keyChangeEn, ja: a.keyChangeJa, es: a.keyChangeEs, fr: a.keyChangeFr },
    locale,
  );
}

/** 头条：近 48h 重要度最高的一条。双栏：左侧标题/摘要，右侧 AI 洞察纵列 */
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
  const insights = [
    { label: tArticle("insightKeyChange"), text: pickKeyChange(article, locale) },
    {
      label: tArticle("insightWhy"),
      text: pickField(
        { zh: article.whyItMatters, en: article.whyItMattersEn, ja: article.whyItMattersJa, es: article.whyItMattersEs, fr: article.whyItMattersFr },
        locale,
      ),
    },
    {
      label: tArticle("insightForward"),
      text: pickField(
        { zh: article.forwardSignal, en: article.forwardSignalEn, ja: article.forwardSignalJa, es: article.forwardSignalEs, fr: article.forwardSignalFr },
        locale,
      ),
    },
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
      <div className="fp-lead-cols">
        <div className="fp-lead-main">
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
        </div>
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
      </div>
    </section>
  );
}

/** 要闻：编号列表，每条带一段「关键变化」洞察摘录 */
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
          const excerpt = pickKeyChange(a, locale);
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
                {excerpt && <p className="fp-brief-excerpt">{excerpt}</p>}
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

/** 持续关注：近 48h 被 ≥2 家信源报道的事件（多源追踪是本站差异化资产） */
export async function FpWatch({
  items,
  locale,
  eventSourceCounts,
}: {
  items: FeedArticle[];
  locale: string;
  eventSourceCounts: Map<string, number>;
}) {
  const tV2 = await getTranslations("v2");
  if (items.length === 0) return null;

  return (
    <section>
      <div className="fp-sec-hd">
        <span className="l">{tV2("watchTitle")}</span>
        <span className="r">{tV2("watchSubtitle")}</span>
      </div>
      <ol className="fp-watch">
        {items.map((a) => {
          const { primary } = pickTitle(a, locale);
          const excerpt = pickKeyChange(a, locale);
          const n = a.eventId ? eventSourceCounts.get(a.eventId) : undefined;
          return (
            <li className="fp-watch-item" key={a.id}>
              <div className="fp-watch-title">
                {a.eventKey ? (
                  <Link href={`/event/${a.eventKey}`}>{primary}</Link>
                ) : (
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    {primary}
                  </a>
                )}
              </div>
              {excerpt && <p className="fp-watch-excerpt">{excerpt}</p>}
              <div className="fp-watch-meta">
                {n != null && n > 1 && a.eventKey ? (
                  <Link href={`/event/${a.eventKey}`}>{tV2("eventReports", { n })}</Link>
                ) : (
                  <span>{a.sourceName}</span>
                )}
                {" · "}
                {formatRelativeTime(a.publishedAt, locale)}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** AI 洞察流：近 48h 全部带分析的条目（精选 4 条之外），按时间倒序 */
export async function FpInsights({
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
        <span className="l">{tV2("insightsTitle")}</span>
        <span className="r">{tV2("insightsSubtitle")}</span>
      </div>
      <ol className="fp-insights">
        {items.map((a) => {
          const { primary } = pickTitle(a, locale);
          const excerpt = pickKeyChange(a, locale);
          const href = leadHref(a);
          const internal = Boolean(a.eventKey);
          return (
            <li className="fp-insight-item" key={a.id}>
              <div className="fp-insight-head">
                <span className="fp-insight-time">
                  {formatRelativeTime(a.publishedAt, locale)}
                </span>
                <div className="fp-insight-title">
                  {internal ? (
                    <Link href={href}>{primary}</Link>
                  ) : (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {primary}
                    </a>
                  )}
                </div>
              </div>
              {excerpt && <p className="fp-insight-excerpt">{excerpt}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
