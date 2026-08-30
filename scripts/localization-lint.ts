/**
 * Localization Linter（Localization Contract #10：语言防污染）。
 * 仅扫描 JSX 文本子节点（标签之间的纯文本，排除 {表达式}），标记硬编码的用户可见文本：
 *   - 英文 UI 常见词（Read More / Loading / Search ...）直接写在 JSX 文本里
 * 命中英文即视为违反契约（应改为 t("ns.key")）。
 * 中文硬编码仅作警告（不阻断），避免误伤属性/变量。
 *
 * 用法：npm run lint:i18n
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOTS = [join(HERE, "..", "src", "components"), join(HERE, "..", "src", "app")];

// 明确的英文 UI 短语（多为按钮/状态/菜单），出现在 JSX 文本里即视为泄漏。
const EN_DENYLIST = [
  "Read More", "Load More", "Loading", "Loading...", "Settings", "Search",
  "No results", "No Results", "Submit", "Cancel", "Save", "Delete", "Edit",
  "Close", "Home", "Menu", "Login", "Logout", "Sign in", "Sign up",
  "View details", "Share", "Copy", "Filter", "Sort", "Language", "Theme",
  "About", "Contact", "Privacy", "Terms", "Retry", "Refresh", "Add", "Remove",
  "Next page", "Previous page", "View More", "Show More", "Load older",
];
const EN_RE = new RegExp(`\\b(${EN_DENYLIST.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`, "i");
const CJK_RE = /[一-鿿぀-ヿ]/;

interface Finding { file: string; line: number; text: string; kind: "en" | "cjk"; }

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function lintFile(file: string): Finding[] {
  const src = readFileSync(file, "utf8");
  const findings: Finding[] = [];
  src.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/, "");
    // 1) 去掉所有 JSX 表达式 { ... }（含 t("x")、变量、属性值等）
    const noExpr = line.replace(/\{[^}]*\}/g, " ");
    // 2) 抽取标签之间的文本子节点：> text <
    const textNodes = noExpr.match(/>([^<>]+)</g) ?? [];
    for (const node of textNodes) {
      const text = node.slice(1, -1).trim();
      if (!text) continue;
      const en = text.match(EN_RE);
      if (en) findings.push({ file, line: i + 1, text: en[0], kind: "en" });
      else if (CJK_RE.test(text)) findings.push({ file, line: i + 1, text: text.slice(0, 32), kind: "cjk" });
    }
  });
  return findings;
}

const files = ROOTS.flatMap(walk);
let errors = 0;
let warnings = 0;
for (const f of files) {
  for (const fnd of lintFile(f)) {
    const rel = f.replace(join(HERE, "..") + "\\", "");
    if (fnd.kind === "en") {
      errors++;
      console.error(`✗ [EN] ${rel}:${fnd.line}  "${fnd.text}"`);
    } else {
      warnings++;
      console.warn(`⚠ [CJK] ${rel}:${fnd.line}  "${fnd.text}"`);
    }
  }
}

if (warnings > 0) {
  console.log(`\n[lint:i18n] ${warnings} 处中文硬编码警告（应改为 t("ns.key")，非阻断）。`);
}
if (errors > 0) {
  console.error(`[lint:i18n] 失败：发现 ${errors} 处硬编码英文 UI 文本（应改为 t("ns.key")）。`);
  process.exit(1);
}
console.log(`[lint:i18n] 通过：未发现 JSX 文本里的硬编码英文 UI 泄漏（扫描 ${files.length} 个文件）。`);
