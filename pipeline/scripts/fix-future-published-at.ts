/**
 * fix-future-published-at.ts —— 一次性回炉「发布时间晚于抓取时间」的行。
 *
 * 背景：个别信源的 CMS 会把"定时发布"的稿子提前放进 RSS，并预写未来的 pubDate
 * （2026-09-24 实测 OpenAI News 有 3 条，领先 19–47 小时）。由于 INSERT OR IGNORE
 * 对已存在的 id/url 整行跳过、published_at 永不刷新，这个错误时间戳会被永久冻结：
 * 该条一直钉在 Latest 顶部，右侧相对时间还因负数差值渲染成 "just now"，
 * 左侧显示一个尚未到来的时刻（用户报「刷新还会出现当天 20:00 的条目」）。
 *
 * 写入侧已在 db.ts 的 insertArticles 加钳制（未来时间一律钳到抓取时刻），
 * 本脚本只负责清理钳制上线之前的存量行。
 *
 * 判定：julianday(published_at) > julianday(fetched_at) —— 因果上不可能，
 * 不依赖"是否还在未来"，所以已过期但当时领先的行也一并修正。
 * 处置：published_at ← fetched_at（最多偏早，不会偏晚）。幂等，可重复触发。
 *
 * 用法：
 *   npx tsx pipeline/scripts/fix-future-published-at.ts --dry-run   # 只列出命中行
 *   npx tsx pipeline/scripts/fix-future-published-at.ts             # 执行修正
 *
 * 生产库操作请在 GitHub Actions 中触发（见 .github/workflows/fix-future-published-at.yml），
 * 不要本地直连生产。
 */
import "../src/env";
import { getDb, ensureSchema } from "../src/db";

const dry = process.argv.includes("--dry-run");

async function main() {
  // 防呆：pipeline/.env.local 并不存在，只 import "../src/env" 会静默回落到
  // file:./data/local.db 本地旧库（约 50 行），于是清洗脚本对着陈旧数据报「命中 0 行」的假成功。
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!/^((libsql|https?):)?\/\//.test(url)) {
    console.error(
      `[fix-future-published-at] 拒绝执行：TURSO_DATABASE_URL 未指向远程库（当前 "${url || "<未设置>"}"）。` +
        " 本地直连请显式注入根目录 .env.local 的两个 TURSO_* 变量；生产清洗走 Actions。",
    );
    process.exit(1);
  }
  await ensureSchema();
  const db = await getDb();

  const hit = await db.execute(
    `SELECT a.id, s.name AS source, a.title, a.published_at, a.fetched_at,
            ROUND((julianday(a.published_at) - julianday(a.fetched_at)) * 24, 1) AS lead_h
       FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE julianday(a.published_at) > julianday(a.fetched_at)
      ORDER BY lead_h DESC`,
  );

  console.log(`[fix-future-published-at] 命中 ${hit.rows.length} 行（dry-run=${dry}）`);
  for (const r of hit.rows) {
    console.log(
      `  lead=${String(r.lead_h)}h [${r.source}] ${String(r.published_at)} > ${String(r.fetched_at)}  ${String(r.title).slice(0, 60)}`,
    );
  }
  if (hit.rows.length === 0) return;
  if (dry) {
    console.log("[fix-future-published-at] dry-run，未写库。去掉 --dry-run 即执行修正。");
    return;
  }

  let updated = 0;
  for (const r of hit.rows) {
    await db.execute({
      sql: "UPDATE articles SET published_at = ? WHERE id = ? AND published_at = ?",
      args: [String(r.fetched_at), String(r.id), String(r.published_at)],
    });
    updated++;
  }
  console.log(`[fix-future-published-at] 已把 ${updated} 行的 published_at 钳制到 fetched_at`);

  const left = await db.execute(
    "SELECT COUNT(*) AS n FROM articles WHERE julianday(published_at) > julianday(fetched_at)",
  );
  console.log(`[fix-future-published-at] 复查残留：${String(left.rows[0].n)} 行`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
