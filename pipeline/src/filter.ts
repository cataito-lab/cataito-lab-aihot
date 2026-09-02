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

export function isAiRelated(title: string, dedicatedSource: boolean): boolean {
  if (dedicatedSource) return true;
  const t = title || "";
  if (!t || t.trim().length < 8) return false;
  const text = ` ${t.toLowerCase()} `;
  // 先过正名单（含 AI 关键词）
  if (!AI_KEYWORDS.some((kw) => text.includes(kw))) return false;
  // 再过负向过滤：论文/问答/空标题一律挡掉
  if (JUNK_PATTERNS.some((re) => re.test(t))) return false;
  return true;
}
