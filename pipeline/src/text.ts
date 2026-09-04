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
