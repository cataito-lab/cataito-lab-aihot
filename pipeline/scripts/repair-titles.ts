/**
 * 一次性数据修复脚本（可幂等重跑）：
 * 1. 删除 Simon Willison 信源及其全部文章与孤儿事件
 * 2. 清洗已入库标题的悬空引号（sanitizeTitle 回填）
 * 3. 重译疑似截断的中文标题（title_zh），清掉对应翻译缓存条目
 *
 * 用法：npx tsx pipeline/scripts/repair-titles.ts [--dry]
 */
import { sanitizeTitle } from "../src/text";
import { looksTruncated } from "../src/translate";
import { getDb } from "../src/db";
import "../src/env";

const isDry = process.argv.includes("--dry");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function deleteSimonWillison(): Promise<{ articles: number; events: number; sourceRow: number }> {
  const db = getDb();
  const cntRs = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM articles WHERE source_id = ?`,
    args: ['simonwillison'],
  });
  const articles = Number(cntRs.rows[0].n);
  if (articles === 0) return { articles: 0, events: 0, sourceRow: 0 };

  if (!isDry) {
    await db.execute({ sql: `DELETE FROM articles WHERE source_id = ?`, args: ['simonwillison'] });
    const evRs = await db.execute({
      sql: `DELETE FROM events WHERE id NOT IN (SELECT DISTINCT event_id FROM articles WHERE event_id IS NOT NULL)`,
      args: [],
    });
    const srcRs = await db.execute({ sql: `DELETE FROM sources WHERE id = ?`, args: ['simonwillison'] });
    return { articles, events: evRs.rowsAffected ?? 0, sourceRow: srcRs.rowsAffected ?? 0 };
  }
  // dry-run: count orphan events without deleting
  const evCnt = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM events WHERE id NOT IN (SELECT DISTINCT event_id FROM articles WHERE event_id IS NOT NULL AND event_id != articles.id)`,
    args: [],
  });
  return { articles, events: Number(evCnt.rows[0].n), sourceRow: articles > 0 ? 1 : 0 };
}

async function sanitizeStoredTitles(): Promise<{ fixed: number; samples: string[] }> {
  const db = getDb();
  // 取所有可能含悬空引号的标题：含 " 或 “ 或 开括号结尾
  const rs = await db.execute({
    sql: `SELECT id, title FROM articles WHERE title LIKE '%"%' OR title LIKE '%“%' OR title LIKE '%「%' OR title LIKE '%『%' OR title LIKE '%《%'`,
    args: [],
  });
  let fixed = 0;
  const samples: string[] = [];
  for (const row of rs.rows) {
    const id = String(row.id);
    const before = String(row.title);
    const after = sanitizeTitle(before);
    if (after !== before) {
      fixed++;
      if (samples.length < 5) samples.push(`  [${id.slice(0, 8)}] ${before}\n   → ${after}`);
      if (!isDry) {
        await db.execute({ sql: `UPDATE articles SET title = ? WHERE id = ?`, args: [after, id] });
      }
    }
  }
  return { fixed, samples };
}

async function retranslateTruncatedZh(): Promise<{ candidates: number; retranslated: number; samples: string[] }> {
  const db = getDb();
  // 取所有有 title_zh 的行做截断检测
  const rs = await db.execute({
    sql: `SELECT id, title, title_zh FROM articles WHERE title_zh IS NOT NULL`,
    args: [],
  });
  const candidates: Array<{ id: string; title: string; oldZh: string }> = [];
  for (const row of rs.rows) {
    const id = String(row.id);
    const title = String(row.title);
    const zh = String(row.title_zh);
    if (looksTruncated(zh, "zh")) {
      candidates.push({ id, title, oldZh: zh });
    }
  }

  const samples: string[] = [];
  let retranslated = 0;
  if (isDry) {
    for (const c of candidates.slice(0, 8)) {
      samples.push(`  [${c.id.slice(0, 8)}] en: ${c.title}\n    old zh: ${c.oldZh}`);
    }
    return { candidates: candidates.length, retranslated: 0, samples };
  }

  // 动态导入避免加载时联网
  const { translateTextSmart } = await import("../src/translate");
  for (const c of candidates) {
    // 清掉这条标题的翻译缓存（避免重译时命中坏缓存）
    await db.execute({ sql: `DELETE FROM title_translations WHERE title = ?`, args: [c.title] });
    const newZh = await translateTextSmart(c.title, "zh-CN");
    if (newZh && !looksTruncated(newZh, "zh")) {
      await db.execute({ sql: `UPDATE articles SET title_zh = ? WHERE id = ?`, args: [newZh, c.id] });
      // 写回缓存
      await db.execute({
        sql: `INSERT INTO title_translations (title, title_zh, created_at) VALUES (?, ?, ?)
              ON CONFLICT(title) DO UPDATE SET title_zh = excluded.title_zh`,
        args: [c.title, newZh, new Date().toISOString()],
      });
      retranslated++;
      if (samples.length < 8) {
        samples.push(`  [${c.id.slice(0, 8)}] en: ${c.title}\n    old: ${c.oldZh}\n    new: ${newZh}`);
      }
    }
    await sleep(200);
  }
  return { candidates: candidates.length, retranslated, samples };
}

async function main() {
  console.log(`[repair] dry=${isDry} start`);

  const sw = await deleteSimonWillison();
  console.log(`[repair] Simon Willison: articles=${sw.articles} orphan events=${sw.events} source row=${sw.sourceRow}`);

  const st = await sanitizeStoredTitles();
  console.log(`[repair] sanitize stored titles: ${st.fixed} fixed`);
  st.samples.forEach((s) => console.log(s));

  const rt = await retranslateTruncatedZh();
  console.log(`[repair] retranslate truncated zh: ${rt.candidates} candidates, ${rt.retranslated} fixed`);
  rt.samples.forEach((s) => console.log(s));

  console.log(`[repair] done`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
