/**
 * 一次性误译清洗（配合 translate.ts 的 _mistakes 安全网，2026-09-06 用户反馈）。
 * 只替换无歧义的固定误译：克劳德→Claude、AI 代理→AI Agent、智能代理→Agent、
 * 小写 openai→OpenAI（SQLite REPLACE 区分大小写，不影响已正确的 OpenAI）。
 * 幂等：跑多次结果一致。用法：npx tsx pipeline/scripts/fix-mistranslations.ts
 */
import "../src/env";
import { getDb } from "../src/db";

// (列, 错误形式, 正确形式)；顺序保证长词条先替换
const FIXES: [string, string, string][] = [
  ["title_zh", "克劳德", "Claude"],
  ["title_zh", "AI 代理", "AI Agent"],
  ["title_zh", "智能代理", "Agent"],
  ["title_zh", "流氓特工", "失控 Agent"],
  ["title_zh", "特工", "Agent"],
  ["title_zh", "openai", "OpenAI"],
  ["summary", "克劳德", "Claude"],
  ["summary", "AI 代理开发者", "AI Agent 开发者"],
  ["summary", "AI 代理", "AI Agent"],
  ["summary", "智能代理", "Agent"],
  ["summary", "流氓特工", "失控 Agent"],
  ["summary", "特工", "Agent"],
  ["summary", "openai", "OpenAI"],
  ["key_change", "克劳德", "Claude"],
  ["key_change", "AI 代理开发者", "AI Agent 开发者"],
  ["key_change", "AI 代理", "AI Agent"],
  ["key_change", "智能代理", "Agent"],
  ["key_change", "特工", "Agent"],
  ["why_it_matters", "克劳德", "Claude"],
  ["why_it_matters", "AI 代理开发者", "AI Agent 开发者"],
  ["why_it_matters", "AI 代理", "AI Agent"],
  ["why_it_matters", "特工", "Agent"],
  ["forward_signal", "克劳德", "Claude"],
  ["forward_signal", "AI 代理", "AI Agent"],
  ["forward_signal", "特工", "Agent"],
  // impact 为 JSON 数组（audience/description），同样按文本替换
  ["impact", "AI 代理开发者", "AI Agent 开发者"],
  ["impact", "AI 代理", "AI Agent"],
  ["impact", "智能代理", "Agent"],
  ["impact", "特工", "Agent"],
  ["impact", "克劳德", "Claude"],
];

async function main(): Promise<void> {
  const db = getDb();
  let total = 0;
  for (const [col, wrong, right] of FIXES) {
    const rs = await db.execute({
      sql: `UPDATE articles SET ${col} = REPLACE(${col}, ?, ?)
            WHERE ${col} IS NOT NULL AND ${col} LIKE ?`,
      args: [wrong, right, `%${wrong}%`],
    });
    const n = Number(rs.rowsAffected ?? 0);
    if (n > 0) {
      console.log(`  ${col}: "${wrong}" → "${right}" x${n}`);
      total += n;
    }
  }
  console.log(`\n[fix-mistranslations] 共修正 ${total} 处`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => process.exit(process.exitCode ?? 0));
