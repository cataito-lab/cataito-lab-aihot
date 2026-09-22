/**
 * 一次性数据修复脚本（可幂等重跑）：清洗存量中文误译「法学硕士/法学博士 → 大语言模型」。
 *
 * 背景：zh 标题翻译通道历史上用 locale "zh-CN"，与术语表键名 "zh" 不一致，
 * 导致全部防护静默旁路（f6cdcd3 已修复根因）。此脚本处理修复前已入库的脏数据：
 * 1. articles 中文内容列原地修正（仅替换 法学硕士/法学博士，不套整表——
 *    令牌/代币在密码货币语境可能是合法译法）
 * 2. 违规 title_zh 所属行重置 translated=0、title_zh=NULL，交由已加固管线重译
 * 3. 删除 title_translations 中含误译的缓存条目（否则重译仍命中旧缓存）
 * 4. events 派生列 title_zh/summary 同口径修正
 *
 * 用法：npx tsx scripts/repair-mistranslations.ts [--dry]
 */
import { getDb } from "../src/db";
import "../src/env";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
// pipeline/.env.local 不存在时 ../src/env 会静默落到 file:./data/local.db 本地旧库，
// 必须显式加载仓库根的 .env.local 才能连上生产 Turso。
dotenv.config({ path: fileURLToPath(new URL("../../.env.local", import.meta.url)), override: true });

const isDry = process.argv.includes("--dry");

const ZH_COLS = [
  "title_zh",
  "summary",
  "key_change",
  "why_it_matters",
  "forward_signal",
  "impact",
  "key_points",
  "industry_impact",
] as const;

const LIKE_SQL = ZH_COLS.map((c) => `${c} LIKE '%法学硕士%' OR ${c} LIKE '%法学博士%'`).join(" OR ");

function fixText(s: string): string {
  return s.split("法学硕士").join("大语言模型").split("法学博士").join("大语言模型");
}

async function main(): Promise<void> {
  const db = getDb();
  let updated = 0;
  let requeued = 0;
  let cacheDeleted = 0;
  let eventsFixed = 0;

  // 1+2. articles：内容列原地修正；误译标题行另置 translated=0、title_zh=NULL 交由管线重译
  const rs = await db.execute({ sql: `SELECT id, title_zh, ${ZH_COLS.join(", ")} FROM articles WHERE ${LIKE_SQL}`, args: [] });
  for (const row of rs.rows) {
    const sets: string[] = [];
    const args: (string | null)[] = [];
    for (const col of ZH_COLS) {
      const v = row[col];
      if (typeof v === "string") {
        const next = fixText(v);
        if (next !== v) {
          sets.push(`${col} = ?`);
          args.push(next);
        }
      }
    }
    const titleBad = sets[0]?.startsWith("title_zh = ?");
    if (titleBad) {
      // 标题走重译而非半截字符串修补
      sets.shift();
      args.shift();
      sets.unshift("title_zh = NULL", "translated = 0");
      requeued++;
    }
    if (sets.length > 0) {
      updated++;
      if (!isDry) await db.execute({ sql: `UPDATE articles SET ${sets.join(", ")} WHERE id = ?`, args: [...args, String(row.id)] });
    }
  }

  // 3. 清掉误译的翻译缓存，否则重译仍会命中旧条目
  const cacheRs = await db.execute({ sql: `SELECT title FROM title_translations WHERE title_zh LIKE '%法学硕士%' OR title_zh LIKE '%法学博士%'`, args: [] });
  cacheDeleted = cacheRs.rows.length;
  if (cacheDeleted > 0 && !isDry) {
    await db.execute({ sql: `DELETE FROM title_translations WHERE title_zh LIKE '%法学硕士%' OR title_zh LIKE '%法学博士%'`, args: [] });
  }

  // 4. events 派生列
  const evRs = await db.execute({ sql: `SELECT id, title_zh, summary FROM events WHERE title_zh LIKE '%法学硕士%' OR title_zh LIKE '%法学博士%' OR summary LIKE '%法学硕士%' OR summary LIKE '%法学博士%'`, args: [] });
  for (const row of evRs.rows) {
    const sets: string[] = [];
    const args: string[] = [];
    for (const col of ["title_zh", "summary"] as const) {
      const v = row[col];
      if (typeof v === "string" && (v.includes("法学硕士") || v.includes("法学博士"))) {
        sets.push(`${col} = ?`);
        args.push(fixText(v));
      }
    }
    if (sets.length > 0) {
      eventsFixed++;
      if (!isDry) await db.execute({ sql: `UPDATE events SET ${sets.join(", ")} WHERE id = ?`, args: [...args, String(row.id)] });
    }
  }

  console.log(
    `${isDry ? "[dry-run] 将" : "已"}修复：内容列修正 ${updated} 行，标题回炉重译 ${requeued} 行，` +
      `翻译缓存删除 ${cacheDeleted} 条，事件修正 ${eventsFixed} 行`
  );

  // 验证：修复后（非 dry）应剩 0
  if (!isDry) {
    const left = await db.execute({ sql: `SELECT COUNT(*) AS n FROM articles WHERE ${LIKE_SQL}`, args: [] });
    const n = Number(left.rows[0].n);
    console.log(n === 0 ? "验证通过：articles 中已无「法学硕士/法学博士」" : `警告：仍有 ${n} 行残留，请检查`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
