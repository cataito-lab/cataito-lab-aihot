/**
 * db-dump.ts —— 全库导出 / 还原（JSONL，每表一个 .ndjson 分片 + 一份 manifest）。
 *
 * 立项理由：2026-09-26 Turso rows-read 超额把整账户的读封掉，结果**数据取不出来**——
 * 仓库里此前没有任何 dump/备份机制。备份必须独立于被封锁的库，所以落 Cloudflare R2。
 *
 * 为什么是 JSONL 而不是 .sql 文本：文本 dump 要自己处理引号/控制字符转义，
 * 一个漏写就把整份备份废掉；这里导出按列拆行、还原走参数化 INSERT，
 * 不存在转义这一类 bug。还原前会先 ensureSchema 建表建索引，FTS 由 articles 上的触发器自动重建。
 *
 * 用法：
 *   npx tsx pipeline/scripts/db-dump.ts --url <库URL> --out .dump
 *   npx tsx pipeline/scripts/db-dump.ts --restore .dump --to file:./.tmp/restored.db
 *   npx tsx pipeline/scripts/db-dump.ts --restore .dump --to libsql://... --yes   # 覆盖远程库需 --yes
 *
 * --url 是必需的而不是便利参数：env.ts 加载 .env.local 时 override，
 * 只设进程环境变量会被静默改指生产库。
 *
 * 生产备份走 .github/workflows/db-backup.yml（每日一次 + 推 R2），不要本地直连生产。
 */
import "../src/env";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createClient, type Client } from "@libsql/client";

// 还原顺序 = 外键依赖顺序（articles.source_id → sources）。
// order 用各表主键：不能用 rowid 分页——article_entities 是 WITHOUT ROWID 表，没有 rowid 列，
// 而 SELECT * 也不会带出其他表的隐式 rowid。
const TABLES: { name: string; order: string }[] = [
  { name: "sources", order: "id" },
  { name: "events", order: "id" },
  { name: "articles", order: "id" },
  { name: "article_entities", order: "entity, article_id" },
  { name: "pipeline_cache", order: "key" },
  { name: "title_translations", order: "title" },
  { name: "fetch_logs", order: "run_id" },
];
const PAGE = 500;

function openClient(url: string): Client {
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
}

async function dump(client: Client, outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const manifest: Record<string, { rows: number; columns: string[] }> = {};

  // 库里可能还没有某些表（如 article_entities 上线前的生产库），先取实际存在的表再导
  const present = await client.execute(
    "SELECT name FROM sqlite_master WHERE type IN ('table','view')",
  );
  const has = new Set(present.rows.map((r) => String(r.name)));

  for (const { name: table, order } of TABLES) {
    if (!has.has(table)) {
      console.warn(`[dump] 跳过 ${table}（该库中不存在）`);
      continue;
    }
    const file = join(outDir, `${table}.ndjson`);
    const stream = createWriteStream(file);
    let rows = 0;
    let columns: string[] = [];
    let offset = 0;

    for (;;) {
      const rs = await client.execute({
        sql: `SELECT * FROM ${table} ORDER BY ${order} LIMIT ? OFFSET ?`,
        args: [PAGE, offset],
      });
      if (rs.rows.length === 0) break;
      if (columns.length === 0) columns = Object.keys(rs.rows[0]);
      for (const row of rs.rows) stream.write(`${JSON.stringify(row)}\n`);
      rows += rs.rows.length;
      offset += rs.rows.length;
      if (rs.rows.length < PAGE) break;
    }
    await new Promise<void>((resolve, reject) =>
      stream.end((err?: Error | null) => (err ? reject(err) : resolve())),
    );
    manifest[table] = { rows, columns };
    console.log(`[dump] ${table}: ${rows} 行 → ${file}`);
  }

  const meta = {
    createdAt: new Date().toISOString(),
    sourceUrl: (process.env.TURSO_DATABASE_URL ?? "").replace(/\/\/[^@]*@/, "//<redacted>@"),
    manifest,
  };
  const metaFile = join(outDir, "manifest.json");
  await streamWrite(metaFile, JSON.stringify(meta, null, 2));
  console.log(`[dump] manifest → ${metaFile}`);
}

function streamWrite(file: string, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = createWriteStream(file);
    s.end(text);
    s.on("finish", () => resolve());
    s.on("error", reject);
  });
}

async function restore(client: Client, inDir: string): Promise<void> {
  const metaFile = join(inDir, "manifest.json");
  if (!existsSync(metaFile)) throw new Error(`缺少 ${metaFile}，无法还原`);
  const meta = JSON.parse(readFileSync(metaFile, "utf8")) as {
    manifest: Record<string, { rows: number; columns: string[] }>;
  };

  for (const { name: table } of TABLES) {
    const entry = meta.manifest[table];
    const file = join(inDir, `${table}.ndjson`);
    if (!entry || !existsSync(file)) {
      console.warn(`[restore] 跳过 ${table}（dump 里没有这张表）`);
      continue;
    }
    if (entry.rows === 0) {
      console.log(`[restore] ${table}: 0 行，跳过`);
      continue;
    }
    const cols = entry.columns;
    const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;
    const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
    let pending: { sql: string; args: (string | number | null)[] }[] = [];
    let done = 0;
    for await (const line of rl) {
      if (!line) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      pending.push({
        sql,
        args: cols.map((c) => {
          const v = row[c];
          return v === undefined || v === null ? null : (v as string | number);
        }),
      });
      if (pending.length >= 50) {
        await client.batch(pending, "write");
        done += pending.length;
        pending = [];
      }
    }
    if (pending.length) {
      await client.batch(pending, "write");
      done += pending.length;
    }
    const check = await client.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    const actual = Number(check.rows[0].n);
    const flag = actual === entry.rows ? "OK" : `不一致（dump=${entry.rows}）`;
    console.log(`[restore] ${table}: 写入 ${done} 行，目标库现有 ${actual} 行 ${flag}`);
    if (actual !== entry.rows) process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const restoreIdx = args.indexOf("--restore");
  const toIdx = args.indexOf("--to");
  const urlIdx = args.indexOf("--url");

  // 必须显式支持 --url：pipeline/src/env.ts 加载 .env.local 时是 override 的，
  // 只靠进程环境变量会被静默改成生产库（实测踩过：子进程拿着 file: 参数却连上了 Turso）。
  if (urlIdx >= 0 && args[urlIdx + 1]) process.env.TURSO_DATABASE_URL = args[urlIdx + 1];

  const url = process.env.TURSO_DATABASE_URL ?? "";
  const redacted = url.replace(/\/\/[^/@]*@/, "//<redacted>@");

  if (restoreIdx >= 0) {
    const dir = args[restoreIdx + 1];
    const target = args[toIdx + 1];
    if (!dir || !target) throw new Error("--restore <dump目录> --to <目标库 URL> 都需要");
    if (/^(libsql:\/\/|https?:\/\/)/.test(target) && !args.includes("--yes")) {
      throw new Error(
        `拒绝还原到远程库 ${target}：这会覆盖生产数据。确认后才加 --yes。`,
      );
    }
    console.log(`[restore] 目标 = ${target}`);
    process.env.TURSO_DATABASE_URL = target;
    process.env.TURSO_AUTH_TOKEN = "";
    const { ensureSchema } = await import("../src/db");
    await ensureSchema();
    await restore(openClient(target), dir);
    return;
  }

  if (!/^(file:|libsql:\/\/|https?:\/\/)/.test(url)) {
    throw new Error(`TURSO_DATABASE_URL 未设置或不可用（当前 "${redacted || "<未设置>"}"）`);
  }
  console.log(`[dump] 源库 = ${redacted}`);
  const outDir = args[outIdx + 1] ?? ".dump";
  await dump(openClient(url), outDir);

  console.log(`[dump] 完成：${readdirSync(outDir).length} 个文件 → ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
