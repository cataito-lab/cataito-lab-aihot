import { createHash } from "node:crypto";
import type { RawItem } from "./types";

const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|igshid|ref|ref_src|ref_url|spm|from|si)$/i;

export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  url.protocol = "https:";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  const entries = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of entries) url.searchParams.append(k, v);
  let out = url.toString();
  if (out.endsWith("/") && new URL(out).pathname !== "/") out = out.slice(0, -1);
  return out;
}

export function sha1Hex(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

export function assignIds(items: RawItem[]): { id: string; item: RawItem }[] {
  const byId = new Map<string, RawItem>();
  for (const item of items) {
    const normalized = normalizeUrl(item.url);
    const id = sha1Hex(normalized);
    if (!byId.has(id)) byId.set(id, { ...item, url: normalized });
  }
  return [...byId.entries()].map(([id, item]) => ({ id, item }));
}
