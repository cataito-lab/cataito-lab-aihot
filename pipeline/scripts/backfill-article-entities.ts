/**
 * backfill-article-entities.ts —— 一次性回填实体规范化表 article_entities。
 *
 * 背景：实体召回原先写成「articles 全表 × json_each(entities) 逐行展开」，每次调用读量
 * ≈ 全表行数 × 每行实体数（2026-09-26 fixture 实测 2 万行库最坏 18 万行读/次），而洞察
 * 阶段是**每篇文章调一次**——这是本月 Turso rows-read 爆到 653M/500M、整站读被封的第一元凶。
 * 改造后召回走 article_entities 的 (entity, article_id) 主键，只读命中行。
 *
 * 表由 articles 上的触发器（articles_entities_au / _ad）跟随后续写入自动维护；
 * 触发器只对**之后的** UPDATE 生效，存量行不会自己进表，所以必须跑本脚本一次。
 * 未回填时 getEntityDictionary 返回空、同事件召回静默降级（会打 warn 日志）。
 *
 * 用法：
 *   npx tsx pipeline/scripts/backfill-article-entities.ts --dry-run   # 只报规模
 *   npx tsx pipeline/scripts/backfill-article-entities.ts             # 执行回填
 *
 * 生产库操作请在 GitHub Actions 中触发（见 .github/workflows/backfill-article-entities.yml），
 * 不要本地直连生产。
 */
import "../src/env";
import { getDb, ensureSchema } from "../src/db";

const dry = process.argv.includes("--dry-run");
const PAGE = 500;

async function main() {
  // 防呆：缺凭据时会静默回落 file:./data/local.db 本地旧库，脚本对着陈旧数据报「回填完成」的假成功。
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!/^((libsql|https?):)?\/\//.test(url)) {
    console.error(
      `[backfill-entities] 拒绝执行：TURSO_DATABASE_URL 未指向远程库（当前 "${url || "<未设置>"}"）。` +
        " 生产回填走 Actions。",
    );
    process.exit(1);
  }

  await ensureSchema();
  const db = await getDb();

  const before = await db.execute(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN json_valid(entities) AND entities != '[]' THEN 1 ELSE 0 END) AS with_entities
       FROM articles`,
  );
  const total = Number(before.rows[0].total);
  const withEntities = Number(before.rows[0].with_entities);
  const already = await db.execute("SELECT COUNT(DISTINCT article_id) AS n FROM article_entities");
  console.log(
    `[backfill-entities] articles=${total} 含实体=${withEntities} 已入表=${Number(already.rows[0].n)}（dry-run=${dry}）`,
  );
  if (dry) {
    console.log("[backfill-entities] dry-run，未写库。去掉 --dry-run 即执行回填。");
    return;
  }

  // 按 id 游标分页：ORDER BY id LIMIT 走主键，避免一条巨型语句撞超时。
  let cursor = "";
  let pages = 0;
  let written = 0;
  for (;;) {
    const res = await db.execute({
      sql: `INSERT OR IGNORE INTO article_entities (entity, label, article_id, published_at)
            SELECT DISTINCT lower(j.value), CAST(j.value AS TEXT), a.id, a.published_at
            FROM (SELECT id, entities, published_at FROM articles WHERE id > ? ORDER BY id LIMIT ?) a,
                 json_each(CASE WHEN json_valid(a.entities) THEN a.entities ELSE '[]' END) j
            WHERE j.value IS NOT NULL`,
      args: [cursor, PAGE],
    });
    const page = await db.execute({
      sql: "SELECT MAX(id) AS m FROM (SELECT id FROM articles WHERE id > ? ORDER BY id LIMIT ?)",
      args: [cursor, PAGE],
    });
    const next = page.rows[0].m == null ? "" : String(page.rows[0].m);
    written += Number(res.rowsAffected);
    pages++;
    if (!next || next === cursor) break;
    cursor = next;
    if (pages % 10 === 0) console.log(`  ...已处理 ${pages} 页 / 累计写入 ${written} 行`);
  }
  console.log(`[backfill-entities] 处理 ${pages} 页，写入 ${written} 行`);

  const after = await db.execute("SELECT COUNT(DISTINCT article_id) AS n FROM article_entities");
  const covered = Number(after.rows[0].n);
  console.log(`[backfill-entities] 复查：入表文章数=${covered} / 含实体文章数=${withEntities}`);
  if (covered < withEntities) {
    console.warn("[backfill-entities] 覆盖不足，请重跑本脚本（INSERT OR IGNORE 幂等）");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
