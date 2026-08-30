/** BCP-47 映射：项目内部用短码（zh/en/ja/es/fr），Intl 需要完整区域码以保证格式正确�?*/
const INTL_LOCALE: Record<string, string> = {
  en: "en-US",
  zh: "zh-CN",
  ja: "ja-JP",
  es: "es-ES",
  fr: "fr-FR",
};

export function intlLocale(locale: string): string {
  return INTL_LOCALE[locale] ?? locale;
}

/** 数字�?locale 格式化（千位分隔随地区变化，�?1,234.5 / 1 234,5）�?*/
export function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale)).format(value);
  } catch {
    return String(value);
  }
}

/** 紧凑数字（如 1.2K / 1,2 K），用于计数展示�?*/
export function formatCompactNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(value);
  }
}

/** 评分/整数�?-100），不带小数�?*/
export function formatScore(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(intlLocale(locale), {
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return String(value);
  }
}

export function formatDate(
  iso: string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(
      intlLocale(locale),
      options ?? { year: "numeric", month: "2-digit", day: "2-digit" },
    ).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDateTime(
  iso: string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(
      intlLocale(locale),
      options ?? {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      },
    ).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** 相对时间（如 "3分钟�? / "3 min ago"），统一�?Intl.RelativeTimeFormat�?*/
export function formatRelativeTime(
  iso: string,
  locale: string,
  now: number = Date.now(),
): string {
  const diffMs = new Date(iso).getTime() - now;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const rtf = (() => {
    try {
      return new Intl.RelativeTimeFormat(intlLocale(locale), {
        numeric: "auto",
      });
    } catch {
      return null;
    }
  })();
  if (!rtf) return iso;
  if (minutes < 60) return rtf.format(Math.round(diffMs / 60000), "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  return rtf.format(-days, "day");
}
