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
  " ai ",
  "-ai",
  "ai-",
  "artificial intelligence",
  "chatbot",
  "agent",
  "人工智能",
  "大模型",
  "机器学习",
  "深度学习",
  "神经网络",
  "智能体",
  "生成式",
];

export function isAiRelated(title: string, dedicatedSource: boolean): boolean {
  if (dedicatedSource) return true;
  const text = ` ${title.toLowerCase()} `;
  return AI_KEYWORDS.some((kw) => text.includes(kw));
}
