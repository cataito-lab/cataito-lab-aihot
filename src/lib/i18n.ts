export interface Titled {
  title: string | null;
  titleZh: string | null;
  titleJa?: string | null;
  titleEs?: string | null;
  titleFr?: string | null;
}

/** 按 locale 选取标题：对应语言 → 原始标题（en/zh）；secondary 为与 primary 不同的原始标题（双语参考）。 */
export function pickTitle(
  a: Titled,
  locale: string,
): { primary: string; secondary: string | null } {
  const t = a.title ?? "";
  if (locale === "zh") {
    const primary = a.titleZh ?? t;
    return { primary, secondary: a.titleZh && a.titleZh !== t ? t : null };
  }
  if (locale === "ja") {
    const primary = a.titleJa ?? t;
    return { primary, secondary: a.titleJa && a.titleJa !== t ? t : null };
  }
  if (locale === "es") {
    const primary = a.titleEs ?? t;
    return { primary, secondary: a.titleEs && a.titleEs !== t ? t : null };
  }
  if (locale === "fr") {
    const primary = a.titleFr ?? t;
    return { primary, secondary: a.titleFr && a.titleFr !== t ? t : null };
  }
  // en
  return { primary: t, secondary: null };
}
