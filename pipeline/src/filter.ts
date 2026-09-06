const AI_KEYWORDS = [
  "gpt",
  "openai",
  "anthropic",
  "claude",
  "gemini",
  "deepseek",
  "llm",
  "llama",
  "qwen",
  "mistral",
  "copilot",
  "machine learning",
  "deep learning",
  "neural network",
  "transformer",
  "diffusion",
  "generative ai",
  "genai",
  "hugging face",
  "langchain",
  "agent",
  "rag ",
  " 2 ",
  " art ",
  " 2020",
  " 2021",
  " 2022",
  " 2023",
  " 2024",
  " 2025",
  " 2026",
  " 2027",
  " 2028",
  " 2029",
  " 2030",
  " 2031",
  " 2032",
];

// Phase 1 反制：这些模式是论文/问答/垃圾标题，即使命中 AI_KEYWORDS 也过滤掉。
// arXiv / HF / News 的学术论文、HN/Reddit 问答、空标题一律不进首页。
const JUNK_PATTERNS = [
  // arXiv 学术论文范式
  /^(a |an |the )?(survey|benchmark|tutorial|overview|review|state[- ]of[- ]the[- ]art)\b/i,
  /^(we|this paper|this work|in this (paper|work)|we propose|we present|we introduce|we design)\b/i,
  /^(towards|toward |on |for |in )\S.*(\. |—|- )\S.*paper\b/i,
  // 标题末尾带 (arxiv|huggingface|pdf) 后缀
  /\b(arxiv|arxiv\.org|huggingface|pdf|preprint)\b/i,
  // HN/Reddit 问答
  /^(what|how|why|which|who|where|is |are |should |do |does |did |can |could |would |will )\b.*\?$/i,
  /^(r\/|reddit|stack|overflow|quora|medium\.com)/i,
];

// 正文级 AI 词表（2026-09-07 正文联合过滤）：只对「dedicated 源但标题无 AI 词」
// 的可疑条目做正文复核。与标题词表分开维护——年份/数字类弱信号不进正文表，
// 否则任何带日期的招聘/活动通告都会误过。
const BODY_AI_RE =
  /\b(ai|a\.i\.|llms?|gpt|agents?|chatbots?|copilots?|openai|anthropic|claude|gemini|deepseek|mistral|llama|qwen|grok|machine learning|deep learning|neural network|artificial intelligence|language model|generative|transformer|diffusion|benchmark|inference|fine-tun|hugging face|embeddings?)\b/i;

function matchesKeyword(text: string): boolean {
  const padded = ` ${text.toLowerCase()} `;
  return AI_KEYWORDS.some((kw) => padded.includes(kw));
}

export function isAiRelated(title: string, dedicatedSource: boolean, content?: string): boolean {
  const t = title || "";
  if (!t || t.trim().length < 8) return false;
  const titleHit = matchesKeyword(t);
  if (dedicatedSource) {
    if (titleHit) return true;
    // 可疑条目（dedicated 源但标题无 AI 词）：有正文则正文必须命中 AI 词；
    // 无正文沿用旧行为放行（HN 等标题源的正文在过滤之后才抓取）
    const body = content?.trim();
    if (!body) return true;
    return BODY_AI_RE.test(body);
  }
  if (!titleHit) return false;
  if (JUNK_PATTERNS.some((re) => re.test(t))) return false;
  return true;
}
