import { countSummariesToday, markSummarized } from "./db";
import { httpFetch } from "./net";

const API_BASE = "https://api.cloudflare.com/client/v4/accounts";

const MODEL = process.env.CF_AI_MODEL ?? "@cf/meta/llama-3.1-8b-instruct";
const DAILY_QUOTA = 500;
const MAX_PER_RUN = 30;

const SYSTEM_PROMPT =
  "你是新闻编辑。根据给定的新闻标题，用简体中文写一句不超过80字的摘要，概括事件本身。只输出摘要文字，不要任何前缀、引号或解释。如果标题信息不足以摘要，输出：暂无摘要。";

export interface SummarizableRow {
  id: string;
  title: string;
  titleZh: string | null;
  sourceName: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runModel(userContent: string): Promise<string | null> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_AI_API_TOKEN;
  if (!accountId || !token) return null;
  const res = await httpFetch(`${API_BASE}/${accountId}/ai/run/${MODEL}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      max_tokens: 200,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Workers AI HTTP ${res.status}`);
  const data = (await res.json()) as { result?: { response?: string } };
  const text = data.result?.response?.trim();
  return text || null;
}

export async function summarizePending(rows: SummarizableRow[]): Promise<number> {
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_AI_API_TOKEN) {
    console.log("  [summarize] skipped (CF_ACCOUNT_ID / CF_AI_API_TOKEN not set)");
    return 0;
  }

  const usedToday = await countSummariesToday();
  let remainingQuota = Math.max(0, DAILY_QUOTA - usedToday);
  let done = 0;

  for (const row of rows) {
    if (done >= MAX_PER_RUN || remainingQuota <= 0) break;
    try {
      const parts = [`标题：${row.titleZh ?? row.title}`];
      if (row.titleZh && row.titleZh !== row.title) parts.push(`原标题：${row.title}`);
      parts.push(`来源：${row.sourceName}`);
      const summary = await runModel(parts.join("\n"));
      const valid = summary && summary !== "暂无摘要";
      await markSummarized(row.id, valid ? summary : null, Boolean(valid));
      if (valid) {
        done++;
        remainingQuota--;
      }
    } catch (err) {
      console.warn(`  [summarize] ${row.id}: ${err instanceof Error ? err.message : err}`);
      break;
    }
    await sleep(100);
  }

  console.log(`  [summarize] model=${MODEL} summarized=${done} quotaLeft=${remainingQuota}`);
  return done;
}
