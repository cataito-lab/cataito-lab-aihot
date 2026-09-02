import { getDb } from "../src/db";

async function main() {
const db = await getDb();

console.log("=== impact JSON samples (with summary) ===");
const rs = await db.execute({
  sql: `SELECT id, impact, impact_en, impact_ja, impact_es, impact_fr FROM articles 
        WHERE impact IS NOT NULL AND summary IS NOT NULL 
        ORDER BY published_at DESC LIMIT 8`,
});
for (const row of rs.rows) {
  console.log(`\n--- id=${String(row.id).slice(0, 8)} ---`);
  console.log("  zh:", row.impact);
  console.log("  en:", row.impact_en);
  console.log("  ja:", row.impact_ja);
  console.log("  es:", row.impact_es);
  console.log("  fr:", row.impact_fr);
}

console.log("\n=== multi-lang summary counts (articles WITH summary) ===");
const r2 = await db.execute({
  sql: `SELECT 
          COUNT(*) AS total,
          SUM(CASE WHEN summary IS NOT NULL THEN 1 ELSE 0 END) AS has_zh,
          SUM(CASE WHEN summary_en IS NOT NULL THEN 1 ELSE 0 END) AS has_en,
          SUM(CASE WHEN summary_ja IS NOT NULL THEN 1 ELSE 0 END) AS has_ja,
          SUM(CASE WHEN summary_es IS NOT NULL THEN 1 ELSE 0 END) AS has_es,
          SUM(CASE WHEN summary_fr IS NOT NULL THEN 1 ELSE 0 END) AS has_fr,
          SUM(CASE WHEN impact IS NOT NULL THEN 1 ELSE 0 END) AS has_impact,
          SUM(CASE WHEN impact_ja IS NOT NULL THEN 1 ELSE 0 END) AS has_impact_ja,
          SUM(CASE WHEN impact_es IS NOT NULL THEN 1 ELSE 0 END) AS has_impact_es,
          SUM(CASE WHEN impact_fr IS NOT NULL THEN 1 ELSE 0 END) AS has_impact_fr
        FROM articles`,
});
for (const r of r2.rows) console.log(r);

console.log("\n=== recent 20 articles: summary coverage ===");
const r3 = await db.execute({
  sql: `SELECT id, published_at,
    CASE WHEN summary IS NOT NULL THEN 'zh' ELSE 'x' END AS zh,
    CASE WHEN summary_en IS NOT NULL THEN 'en' ELSE 'x' END AS en,
    CASE WHEN summary_ja IS NOT NULL THEN 'ja' ELSE 'x' END AS ja,
    CASE WHEN summary_es IS NOT NULL THEN 'es' ELSE 'x' END AS es,
    CASE WHEN summary_fr IS NOT NULL THEN 1 ELSE 0 END AS fr
    FROM articles ORDER BY published_at DESC LIMIT 20`,
});
for (const row of r3.rows) {
  console.log(
    `id=${String(row.id).slice(0,8)} ${row.published_at}`.padEnd(32),
    row.zh, row.en, row.ja, row.es, row.fr
  );
}

console.log("\n=== quote/symbol scan on sample summaries ===");
const r4 = await db.execute({
  sql: `SELECT summary, title FROM articles WHERE summary IS NOT NULL ORDER BY published_at DESC LIMIT 30`,
});
let issueCount = 0;
for (const row of r4.rows) {
  const s = String(row.summary);
  // 英文引号出现在中文文本中
  const hasStray = /["'']/g.test(s) && /[\u4e00-\u9fff]/.test(s);
  if (hasStray) {
    issueCount++;
    if (issueCount <= 5) {
      console.log(`\n  title: ${row.title}`);
      console.log(`  summary: ${s.slice(0, 200)}`);
    }
  }
}
console.log(`\nTotal zh summaries with stray ASCII quotes: ${issueCount} / 30`);

// === impact JSON structure scan (show first 5 raw) ===
console.log("\n=== raw impact JSON samples ===");
const r5 = await db.execute({
  sql: `SELECT impact FROM articles WHERE impact IS NOT NULL ORDER BY published_at DESC LIMIT 15`,
});
for (const row of r5.rows) {
  const raw = String(row.impact);
  try {
    const p = JSON.parse(raw);
    console.log(`  items=${Array.isArray(p)?p.length:0}`);
    if (Array.isArray(p) && p.length) {
      console.log(`    sample item: ${JSON.stringify(p[0]).slice(0, 240)}`);
      // extract any audience string with English letters
      for (const it of p) {
        if (typeof it === "object" && it && typeof it.audience === "string") {
          const a = it.audience;
          if (/[A-Za-z]/.test(a) && /\u4e00-\u9fff/.test(a)) {
            console.log(`    [MIX] "${a.slice(0,180)}"`);
          }
        }
      }
    }
  } catch (e) { console.log(`  parse error: ${raw.slice(0,120)}`); }
}

// === impact JSON language breakdown ===
console.log("\n=== impact JSON language breakdown (article impact_zh / _en / _ja / _es / _fr) ===");
const r6 = await db.execute({
  sql: `SELECT impact FROM articles WHERE impact IS NOT NULL ORDER BY published_at DESC LIMIT 50`,
});
let counts = { zh: 0, en: 0, ja: 0, es: 0, fr: 0 };
for (const row of r6.rows) {
  try {
    const p = JSON.parse(String(row.impact));
    if (p.audience) { const a = p.audience as any;
      if (a.zh) counts.zh++; if (a.en) counts.en++;
      if (a.ja) counts.ja++; if (a.es) counts.es++; if (a.fr) counts.fr++;
    }
  } catch { /* skip */ }
}
console.log(`  impact.audience: zh=${counts.zh} en=${counts.en} ja=${counts.ja} es=${counts.es} fr=${counts.fr}  (out of 50)`);
}
main();
