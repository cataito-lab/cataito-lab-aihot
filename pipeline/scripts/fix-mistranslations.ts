/**
 * 存量误译清洗（幂等）。替换规则单一真源：glossary.json 的 "_mistakes"。
 * 对每个 locale 的误译表，应用到该语言对应的全部内容列：
 * - articles（zh: title_zh/summary/key_change/why_it_matters/forward_signal/impact）
 * - events（热榜主体，用户直接可见；聚类会从 articles 重生，但两次聚类之间仍需清洗）
 * 长错误形式优先替换，避免「AI 代理开发者」被「AI 代理」抢先截断。
 * 用法：npx tsx pipeline/scripts/fix-mistranslations.ts
 */
import "../src/env";
import { readFileSync } from "node:fs";
import { getDb } from "../src/db";

type Mistakes = Record<string, Record<string, string>>;

/** locale → [表, 列]（与 pipeline/src/db.ts 的多语言列命名一致） */
const LOCALE_COLUMNS: Record<string, Array<{ table: string; columns: string[] }>> = {
  zh: [
    { table: "articles", columns: ["title_zh", "summary", "key_change", "why_it_matters", "forward_signal", "impact"] },
    { table: "events", columns: ["title_zh", "summary"] },
  ],
};

async function main(): Promise<void> {
  const glossaryPath = new URL("../data/glossary.json", import.meta.url);
  const glossary = JSON.parse(readFileSync(glossaryPath, "utf8")) as Mistakes;
  const mistakes = glossary._mistakes ?? {};

  const db = getDb();
  let total = 0;
  for (const [locale, table] of Object.entries(mistakes)) {
    const targets = LOCALE_COLUMNS[locale];
    if (!targets) {
      console.warn(`  [skip] locale ${locale} 无对应列映射`);
      continue;
    }
    // 长错误形式优先
    const pairs = Object.entries(table).sort((a, b) => b[0].length - a[0].length);
    for (const { table: tbl, columns } of targets) {
      for (const col of columns) {
        for (const [wrong, right] of pairs) {
          const rs = await db.execute({
            sql: `UPDATE ${tbl} SET ${col} = REPLACE(${col}, ?, ?)
                  WHERE ${col} IS NOT NULL AND instr(${col}, ?) > 0`,
            args: [wrong, right, wrong],
          });
          const n = Number(rs.rowsAffected ?? 0);
          if (n > 0) {
            console.log(`  ${tbl}.${col}: "${wrong}" → "${right}" x${n}`);
            total += n;
          }
        }
      }
    }
  }
  console.log(`\n[fix-mistranslations] 共修正 ${total} 处`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => process.exit(process.exitCode ?? 0));
