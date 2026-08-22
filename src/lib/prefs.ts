"use client";

import { CATEGORY_IDS } from "./types";

export const PREFS_COOKIE = "radar_cats";
const MAX_AGE = 60 * 60 * 24 * 365;

let lastRaw: string | null = null;
let cached: string[] = [];

export function readPrefsFromCookie(): string[] {
  if (typeof document === "undefined") return cached;
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${PREFS_COOKIE}=([^;]*)`),
  );
  const raw = match ? match[1] : "";
  if (raw === lastRaw) return cached;
  lastRaw = raw;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw || "[]")) as unknown;
    cached = Array.isArray(parsed)
      ? parsed.filter(
          (x): x is string =>
            typeof x === "string" && (CATEGORY_IDS as readonly string[]).includes(x),
        )
      : [];
  } catch {
    cached = [];
  }
  return cached;
}

export function savePrefsCookie(cats: string[]): void {
  const valid = cats.filter((c) => (CATEGORY_IDS as readonly string[]).includes(c));
  const value =
    valid.length === 0 || valid.length === CATEGORY_IDS.length
      ? ""
      : encodeURIComponent(JSON.stringify(valid));
  document.cookie = `${PREFS_COOKIE}=${value}; path=/; max-age=${MAX_AGE}; samesite=lax`;
  window.dispatchEvent(new Event(PREFS_COOKIE));
}
