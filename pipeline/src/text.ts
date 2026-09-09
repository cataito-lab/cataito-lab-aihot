// 零依赖 HTML 实体解码。部分源把实体双重编码（如 &amp;#8216;），rss-parser 只解一层，
// 残留的 &#8216; 会原样漏到前端标题（2026-09-05 线上实测 The Verge 卡标题）。
// 循环至多 3 遍以还原双重编码；无实体或未命中命名表时原样返回，幂等。
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  times: "×",
  laquo: "«",
  raquo: "»",
};

const ENTITY_RE = /&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g;

function replaceEntity(whole: string, hex: string, dec: string, name: string): string {
  if (hex) {
    const code = Number.parseInt(hex, 16);
    return Number.isSafeInteger(code) ? String.fromCodePoint(code) : whole;
  }
  if (dec) {
    const code = Number.parseInt(dec, 10);
    return Number.isSafeInteger(code) ? String.fromCodePoint(code) : whole;
  }
  return (name && NAMED[name]) || whole;
}

export function decodeEntities(input: string): string {
  if (!input.includes("&")) return input;
  let out = input;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(ENTITY_RE, replaceEntity);
    if (next === out) break;
    out = next;
  }
  return out;
}

// 悬空结尾字符：完整标题不会以弯引号开符或开括号收尾。
// 直引号 " 不在此列——它可能是闭符（"…cost efficiency"），靠奇偶计数判断。
const TRAILING_OPEN_RE = /[\u201C\u300C\u300E\u300A\uFF08(]$/;

/** 入站标题清洗（幂等）：上游截断会产生未闭合引号（2026-09-07 线上案例：
 *  HN 标题 'Kevin Bass on X: "Women gained …' 以半个引号收尾），
 *  直接入库会让所有语言版本继承残句观感。这里做保守修复——
 *  只删掉悬空的那个引号，不猜测截断掉的正文内容。 */
export function sanitizeTitle(raw: string): string {
  let out = raw.replace(/\s+/g, " ").trim();
  if (!out) return out;
  if (TRAILING_OPEN_RE.test(out)) {
    out = out.slice(0, -1).trim();
  }
  // 直引号总数为奇数 = 有一个没配对：移除最后一个孤立引号
  const straight = (out.match(/"/g) ?? []).length;
  if (straight % 2 === 1) {
    const last = out.lastIndexOf('"');
    if (last >= 0) out = (out.slice(0, last) + out.slice(last + 1)).trim();
  }
  return out;
}
