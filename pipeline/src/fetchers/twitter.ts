import { httpFetch } from "../net";
import type { RawItem, SourceDef } from "../types";

const TWITTER_API_BASE = "https://api.twitter.com/2";

/**
 * C7：X/Twitter 实时检索 fetcher（脚手架）。
 *
 * X 官方 API v2 的 recent search 需要付费 Bearer Token（TWITTER_BEARER_TOKEN），
 * 本仓库当前没有该凭证，故默认不启用（sources.json 中对应源 enabled:false）。
 * 当用户配置好 token 并将源 enabled 置为 true 后即可生效。
 *
 * 注意：免费/基础层通常不含 recent search 权限，需要 Enterprise/Pro 级访问。
 */
export async function fetchTwitter(source: SourceDef, windowHours: number): Promise<RawItem[]> {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) {
    console.warn(`  [twitter] ${source.id}: TWITTER_BEARER_TOKEN 未配置，跳过（源已禁用则不触发）`);
    return [];
  }

  const query = source.twitterQuery || "AI";
  const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
  const url =
    `${TWITTER_API_BASE}/tweets/search/recent` +
    `?query=${encodeURIComponent(`${query} -is:retweet lang:en`)}` +
    `&max_results=100` +
    `&start_time=${encodeURIComponent(since)}` +
    `&tweet.fields=created_at,author_id` +
    `&expansions=author_id` +
    `&user.fields=username`;

  const res = await httpFetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "aihot-pipeline/1.0",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`twitter API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    data?: Array<{ id: string; text: string; created_at: string; author_id: string }>;
    includes?: { users?: Array<{ id: string; username: string }> };
  };
  const users = new Map((data.includes?.users || []).map((u) => [u.id, u.username]));

  return (data.data || []).map((t) => {
    const username = users.get(t.author_id) || t.author_id;
    return {
      sourceId: source.id,
      title: t.text.replace(/\s+/g, " ").slice(0, 140),
      url: `https://twitter.com/${username}/status/${t.id}`,
      publishedAt: t.created_at,
      sourceTimezone: "UTC",
      author: username,
    };
  });
}
