import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { pickField, pickImpact, pickSummary } from "@/lib/localize";
import { pickTitle } from "@/lib/i18n";
import { formatDate, formatScore } from "@/lib/format";
import type { FeedArticle } from "@/lib/types";

/** impact.direction 中文 canonical key → messages key + CSS data-dir */
const DIR_KEY: Record<string, string> = {
  潜在受益: "beneficiary",
  潜在承压: "atRisk",
  值得关注: "watching",
  中性: "neutral",
};

interface PickCardProps {
  article: FeedArticle;
  locale: string;
  rank: number;
  /** 同事件在本期精选中的信源数（单篇事件为 0/undefined） */
  eventSources?: number;
}

export async function PickCard({ article, locale, rank, eventSources }: PickCardProps) {
  const tArticle = await getTranslations("article");
  const tV2 = await getTranslations("v2");

  const { primary } = pickTitle(article, locale);
  const importance = article.importanceScore ?? article.scoreFinal ?? 0;
  const tier = importance >= 80 ? "major" : importance >= 65 ? "important" : null;

  const keyChange = pickField(
    {
      zh: article.keyChange,
      en: article.keyChangeEn,
      ja: article.keyChangeJa,
      es: article.keyChangeEs,
      fr: article.keyChangeFr,
    },
    locale,
  );
  const whyItMatters = pickField(
    {
      zh: article.whyItMatters,
      en: article.whyItMattersEn,
      ja: article.whyItMattersJa,
      es: article.whyItMattersEs,
      fr: article.whyItMattersFr,
    },
    locale,
  );
  const forwardSignal = pickField(
    {
      zh: article.forwardSignal,
      en: article.forwardSignalEn,
      ja: article.forwardSignalJa,
      es: article.forwardSignalEs,
      fr: article.forwardSignalFr,
    },
    locale,
  );
  const impacts = pickImpact(
    {
      zh: article.impact,
      en: article.impactEn,
      ja: article.impactJa,
      es: article.impactEs,
      fr: article.impactFr,
    },
    locale,
  );
  const lede = pickSummary(article, locale);
  const hasInsight = Boolean(keyChange || whyItMatters || forwardSignal || impacts);

  return (
    <article className="v2-pick">
      <span className="v2-pick-rank" data-top={rank <= 3}>
        #{rank}
      </span>
      {tier && (
        <span className="v2-pick-tier" data-tier={tier}>
          {formatScore(importance, locale)} · {tArticle("importance")}
        </span>
      )}
      <h3 className="v2-pick-title">
        <a href={article.url} target="_blank" rel="noopener noreferrer">
          {primary}
        </a>
      </h3>
      {lede && <p className="v2-pick-lede">{lede}</p>}

      {hasInsight ? (
        <div className="v2-insight">
          {keyChange && (
            <div className="v2-insight-row">
              <span className="v2-insight-label">{tArticle("insightKeyChange")}</span>
              <span className="v2-insight-text">{keyChange}</span>
            </div>
          )}
          {whyItMatters && (
            <div className="v2-insight-row">
              <span className="v2-insight-label">{tArticle("insightWhy")}</span>
              <span className="v2-insight-text">{whyItMatters}</span>
            </div>
          )}
          {forwardSignal && (
            <div className="v2-insight-row">
              <span className="v2-insight-label">{tArticle("insightForward")}</span>
              <span className="v2-insight-text">{forwardSignal}</span>
            </div>
          )}
          {impacts && (
            <div className="v2-insight-row">
              <span className="v2-insight-label">{tArticle("insightImpact")}</span>
              <ul className="v2-impact-list">
                {impacts.map((imp, i) => (
                  <li
                    key={i}
                    className="v2-impact-item"
                    data-dir={imp.direction ? DIR_KEY[imp.direction] : undefined}
                  >
                    <b>{imp.audience}</b>
                    <span>{imp.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <p className="v2-no-insight">{tV2("noInsight")}</p>
      )}

      <div className="v2-pick-foot">
        <span>{article.sourceName}</span>
        <span>{formatDate(article.publishedAt, locale)}</span>
        {eventSources != null && eventSources > 1 && article.eventKey && (
          <Link
            href={`/event/${article.eventKey}`}
            className="v2-chip"
            data-accent="true"
          >
            {tV2("eventReports", { n: eventSources })}
          </Link>
        )}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="v2-chip"
        >
          {tArticle("verify")}
        </a>
      </div>
    </article>
  );
}
