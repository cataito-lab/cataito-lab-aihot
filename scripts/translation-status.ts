/**
 * 翻译状态审计（Localization Contract #6：translation_status）。
 * 从 articles 表按语言推导各本地化列的完成度（completed=pending）：
 *   - 统计每语言若干核心列的「非空占比」
 *   - 缺失的语言前端应按契约显式处理缺失态，不得假装有该语言。
 *
 * 用法：npm run i18n:status   （可选 DB 路径：DB_PATH=path npm run i18n:status）
 */
import { createClient } from "@libsql/client";

const DB_PATH = process.env.DB_PATH ?? "pipeline/data/local.db";
const dbUrl = /^https?:\/\//.test(DB_PATH) ? DB_PATH : `file:${DB_PATH}`;
const client = createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN });

// 每语言对应的「本地化核心列」候选集合（非空即视为该语言已译）。
// 实际仅统计数据库中存在的列（兼容不同迁移阶段的 schema）。
const GROUPS: Record<string, string[]> = {
  zh: ["title_zh", "summary", "key_change", "why_it_matters", "forward_signal", "impact"],
  en: ["summary_en", "key_change_en", "why_it_matters_en", "forward_signal_en", "impact_en"],
  ja: ["title_ja", "summary_ja", "key_change_ja", "forward_signal_ja", "impact_ja"],
  es: ["title_es", "summary_es", "key_change_es", "forward_signal_es", "impact_es"],
  fr: ["title_fr", "summary_fr", "key_change_fr", "forward_signal_fr", "impact_fr"],
};

async function existingColumns(): Promise<Set<string>> {
  const rs = await client.execute({ sql: "PRAGMA table_info(articles)", args: [] });
  return new Set(rs.rows.map((r) => String(r.name)));
}

async function countNonNull(column: string): Promise<number> {
  const rs = await client.execute({
    sql: `SELECT COUNT(*) AS c FROM articles WHERE ${column} IS NOT NULL AND ${column} != ''`,
    args: [],
  });
  return Number(rs.rows[0]?.c ?? 0);
}

async function main(): Promise<void> {
  const totalRs = await client.execute({ sql: "SELECT COUNT(*) AS c FROM articles", args: [] });
  const total = Number(totalRs.rows[0]?.c ?? 0);
  if (total === 0) {
    console.log("[i18n:status] articles 表为空，跳过。");
    return;
  }

  const cols = await existingColumns();
  const groups = Object.fromEntries(
    Object.entries(GROUPS).map(([loc, cands]) => [loc, cands.filter((c) => cols.has(c))]),
  );
  const skipped = Object.entries(groups).filter(([, c]) => c.length === 0).map(([l]) => l);
  if (skipped.length) {
    console.log(`[i18n:status] 注意：以下语言在当前 schema 无对应本地化列，已跳过 → ${skipped.join(", ")}`);
  }

  console.log(`[i18n:status] articles 总数 = ${total}\n`);
  console.log("语言   完成度(核心列均值)   各列非空率");
  for (const [locale, cs] of Object.entries(groups)) {
    if (cs.length === 0) continue;
    const rates: string[] = [];
    let sum = 0;
    for (const col of cs) {
      const n = await countNonNull(col);
      const pct = Math.round((n / total) * 100);
      sum += pct;
      rates.push(`${col}=${pct}%`);
    }
    const avg = Math.round(sum / cs.length);
    console.log(
      `${locale.padEnd(6)} ${String(avg).padStart(3)}%               ${rates.join("  ")}`,
    );
  }
  console.log(
    "\n说明：低于 100% 表示该语言部分内容尚未生成翻译（pending）。" +
      "前端经 localize.ts 缺译返回 null，应显式处理缺失态。",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[i18n:status] 错误：", err);
    process.exit(1);
  });
