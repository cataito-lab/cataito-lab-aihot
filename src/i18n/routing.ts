import { defineRouting } from "next-intl/routing";

/**
 * Locales — single source of truth.
 * Default is English (international-first). To add a language:
 *   1. append the code to `locales`
 *   2. create messages/{locale}.json with all keys
 *   everything else derives from routing.locales.
 */
export const locales = ["en", "zh", "ja", "es", "fr"] as const;
export const defaultLocale = "en";

export const routing = defineRouting({
  locales,
  defaultLocale,
  // Never sniff the browser/geo language: everyone lands on the default
  // (English) until they explicitly pick a locale via the switcher.
  localeDetection: false,
});