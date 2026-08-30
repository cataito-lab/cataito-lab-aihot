/**
 * i18n 一致性测试（Localization Contract #11）。
 * 校验 messages/{en,zh,ja,es,fr}.json 五语言 key 完全对齐：
 * 任一语言缺失/多余 key 即视为失败，退出码 1。
 *
 * 用法：npm run i18n:check
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = join(HERE, "..", "messages");
const LOCALES = ["en", "zh", "ja", "es", "fr"] as const;

type Dict = Record<string, unknown>;

function flatten(obj: Dict, prefix = ""): Set<string> {
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const child of flatten(v as Dict, path)) keys.add(child);
    } else {
      keys.add(path);
    }
  }
  return keys;
}

function load(locale: string): { keys: Set<string>; raw: Dict } {
  const file = join(MESSAGES_DIR, `${locale}.json`);
  if (!existsSync(file)) {
    console.error(`✗ 缺失 messages/${locale}.json`);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(file, "utf8")) as Dict;
  return { keys: flatten(raw), raw };
}

const loaded = LOCALES.map((l) => ({ locale: l, ...load(l) }));
const reference = loaded[0];
let failed = false;

for (const { locale, keys } of loaded) {
  const missing = [...reference.keys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !reference.keys.has(k));
  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ ${locale}: ${keys.size} keys 对齐`);
  } else {
    failed = true;
    if (missing.length) console.error(`✗ ${locale}: 缺失 ${missing.length} 个 key → ${missing.join(", ")}`);
    if (extra.length) console.error(`✗ ${locale}: 多余 ${extra.length} 个 key → ${extra.join(", ")}`);
  }
}

if (failed) {
  console.error("\n[i18n:check] 失败：messages 多语言 key 未对齐。");
  process.exit(1);
}
console.log(`\n[i18n:check] 通过：5 语言共 ${reference.keys.size} 个 key 完全对齐。`);
