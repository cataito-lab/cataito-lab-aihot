import { localizeAudience } from "@/lib/audiences";

/** 同时具备五种语言列的字段集合（核心结论 / 为何重要 / 前瞻信号 / 影响对象）。 */
export interface LocalizedField {
  zh: string | null;
  en: string | null;
  ja: string | null;
  es: string | null;
  fr: string | null;
}

/** 同时具备五种语言摘要列的对象（FeedArticle / EventMember）。 */
export interface Summarizable {
  summary: string | null;
  summaryEn: string | null;
  summaryJa: string | null;
  summaryEs: string | null;
  summaryFr: string | null;
}

/**
 * 严格语言隔离的取值函数集合（Localization Contract 的核心实现）。
 *
 * 铁律：只返回「目标 locale」对应的列；该列缺失即返回 null，
 * 绝不回退到其它语言（避免跨语言串台 / 串语言污染）。
 * 缺失内容的展示策略（占位 / 隐藏）由调用方决定，本层不做任何语言猜测。
 */
export function pickField(v: LocalizedField, locale: string): string | null {
  if (locale === "zh") return v.zh;
  if (locale === "en") return v.en;
  if (locale === "ja") return v.ja;
  if (locale === "es") return v.es;
  if (locale === "fr") return v.fr;
  return v.en;
}

export function pickSummary(a: Summarizable, locale: string): string | null {
  if (locale === "zh") return a.summary;
  if (locale === "ja") return a.summaryJa;
  if (locale === "es") return a.summaryEs;
  if (locale === "fr") return a.summaryFr;
  return a.summaryEn;
}

export function pickImpact(v: LocalizedField, locale: string): { audience: string; description: string }[] | null {
  const raw =
    locale === "zh"
      ? v.zh
      : locale === "ja"
        ? v.ja
        : locale === "es"
          ? v.es
          : locale === "fr"
            ? v.fr
            : v.en;
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    const out = arr
      .filter(
        (x): x is { audience: string; description: string } =>
          !!x &&
          typeof (x as Record<string, unknown>).audience === "string" &&
          typeof (x as Record<string, unknown>).description === "string",
      )
      .slice(0, 4)
      .map((x) => ({ audience: localizeAudience(x.audience, locale), description: x.description }));
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export function pickTags(zhJson: string | null, enJson: string | null, locale: string): string[] | null {
  const raw = locale === "zh" ? zhJson : locale === "en" ? enJson : null;
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return null;
    const out = arr.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 3);
    return out.length ? out : null;
  } catch {
    return null;
  }
}
