/**
 * 受众（impact.audience）受控词表与本地化。
 *
 * 设计动机（见 TECH_SPEC §12 / OPERATIONS §3.2）：
 * - 受众是自由文本，模型每次可能生成新写法，且存量文章 impact_ja/es/fr 可能为空
 *   （回退到英文 impactEn 时受众会显示成英文）。逐篇机器翻译既慢又易漏。
 * - 因此把受众收敛为**受控词表**：每条受众有 zh/en/ja/es/fr 五个确定标签，
 *   渲染时按 UI locale 直接查表，保证「影响谁」板块的受众**永远**是本地语言，
 *   与翻译进度、是否与英文回退无关。新受众只要落到词表即天然五语齐全。
 * - 词表同时作为管线提示词的约束（summarize.ts SYSTEM_PROMPT），从源头减少自由发挥。
 *
 * 匹配：对输入做归一化（小写、去空格与标点、保留中日韩与字母数字）后与词表所有
 * 语言标签 / 别名做精确匹配；命中则返回对应 locale 标签，未命中原样返回（不影响已翻译内容）。
 */

export type AudienceLocale = "zh" | "en" | "ja" | "es" | "fr";

interface AudienceEntry {
  key: string;
  zh: string;
  en: string;
  ja: string;
  es: string;
  fr: string;
  aliases?: string[];
}

const TAXONOMY: AudienceEntry[] = [
  { key: "government", zh: "政府", en: "Governments", ja: "政府", es: "Gobiernos", fr: "Gouvernements", aliases: ["政府部门", "当局", "公共部门"] },
  { key: "regulators", zh: "监管机构", en: "Regulators", ja: "規制当局", es: "Reguladores", fr: "Régulateurs", aliases: ["监管", "监管方", "监管者", "监管部门"] },
  { key: "policymakers", zh: "政策制定者", en: "Policymakers", ja: "政策立案者", es: "Formuladores de políticas", fr: "Décideurs politiques", aliases: ["决策者", "政策制订者"] },
  { key: "enterprises", zh: "企业", en: "Enterprises", ja: "企業", es: "Empresas", fr: "Entreprises", aliases: ["公司", "商企"] },
  { key: "smes", zh: "中小企业", en: "SMEs", ja: "中小企業", es: "PYMES", fr: "PME", aliases: ["小企业", "中小微企业"] },
  { key: "startups", zh: "初创公司", en: "Startups", ja: "スタートアップ", es: "Startups", fr: "Start-ups", aliases: ["创业公司", "初创企业", "新创公司"] },
  { key: "tech_companies", zh: "科技公司", en: "Tech Companies", ja: "テック企業", es: "Empresas tecnológicas", fr: "Entreprises technologiques", aliases: ["科技企业", "技术公司", "互联网公司"] },
  { key: "ai_companies", zh: "AI 公司", en: "AI Companies", ja: "AI 企業", es: "Empresas de IA", fr: "Entreprises d'IA", aliases: ["人工智能公司", "AI企业", "大模型公司"] },
  { key: "cloud_providers", zh: "云服务商", en: "Cloud Providers", ja: "クラウド事業者", es: "Proveedores de nube", fr: "Fournisseurs cloud", aliases: ["云厂商", "云服务", "云计算厂商"] },
  { key: "data_center_ops", zh: "数据中心运营商", en: "Data Center Operators", ja: "データセンター事業者", es: "Operadores de centros de datos", fr: "Opérateurs de centres de données", aliases: ["数据中心", "IDC", "算力运营商"] },
  { key: "chip_makers", zh: "芯片制造商", en: "Chip Makers", ja: "半導体メーカー", es: "Fabricantes de chips", fr: "Fabricants de puces", aliases: ["芯片厂", "半导体厂商", "晶圆厂", "芯片制造商"] },
  { key: "developers", zh: "开发者", en: "Developers", ja: "開発者", es: "Desarrolladores", fr: "Développeurs", aliases: ["开发", "程序员", "工程师", "开发团队", "研发人员", "研发者", "开发人员"] },
  { key: "researchers", zh: "研究人员", en: "Researchers", ja: "研究者", es: "Investigadores", fr: "Chercheurs", aliases: ["科研", "科研人员", "学者", "研究員"] },
  { key: "ai_researchers", zh: "AI 研究者", en: "AI Researchers", ja: "AI 研究者", es: "Investigadores de IA", fr: "Chercheurs en IA", aliases: ["人工智能研究者", "AI研究", "AI 研究", "人工智能研究"] },
  { key: "academia", zh: "学术界", en: "Academia", ja: "学界", es: "Academia", fr: "Monde académique", aliases: ["高校", "大学", "学术圈"] },
  { key: "students", zh: "学生", en: "Students", ja: "学生", es: "Estudiantes", fr: "Étudiants", aliases: ["在校生", "学习者"] },
  { key: "investors", zh: "投资者", en: "Investors", ja: "投資家", es: "Inversores", fr: "Investisseurs", aliases: ["投资人", "资本", "风投", "VC"] },
  { key: "finance", zh: "金融行业", en: "Finance", ja: "金融業界", es: "Sector financiero", fr: "Secteur financier", aliases: ["金融业", "金融", "银行", "资本市场"] },
  { key: "healthcare", zh: "医疗行业", en: "Healthcare", ja: "医療業界", es: "Sector salud", fr: "Secteur de la santé", aliases: ["医疗", "医疗界", "医药", "卫健"] },
  { key: "education", zh: "教育界", en: "Education", ja: "教育界", es: "Educación", fr: "Éducation", aliases: ["教育", "教育行业", "学校"] },
  { key: "media", zh: "媒体", en: "Media", ja: "メディア", es: "Medios", fr: "Médias", aliases: ["新闻界", "记者", "新闻出版"] },
  { key: "journalists", zh: "记者", en: "Journalists", ja: "ジャーナリスト", es: "Periodistas", fr: "Journalistes", aliases: ["新闻工作者"] },
  { key: "content_creators", zh: "内容创作者", en: "Content Creators", ja: "コンテンツクリエイター", es: "Creadores de contenido", fr: "Créateurs de contenu", aliases: ["创作者", "UP主", "博主", "自媒体"] },
  { key: "artists", zh: "艺术家", en: "Artists", ja: "アーティスト", es: "Artistas", fr: "Artistes", aliases: ["艺术从业者", "画家", "设计师"] },
  { key: "musicians", zh: "音乐人", en: "Musicians", ja: "ミュージシャン", es: "Músicos", fr: "Musiciennes et musiciens", aliases: ["音乐从业者", "音乐工作者", "歌手"] },
  { key: "consumers", zh: "消费者", en: "Consumers", ja: "消費者", es: "Consumidores", fr: "Consommateurs", aliases: ["用户", "终端用户", "顾客", "C端用户"] },
  { key: "general_public", zh: "普通用户", en: "General Public", ja: "一般ユーザー", es: "Público general", fr: "Grand public", aliases: ["一般用户", "大众", "公众", "普通人", "普通大众", "普通读者"] },
  { key: "cybersecurity", zh: "网络安全从业者", en: "Cybersecurity Professionals", ja: "サイバーセキュリティ従事者", es: "Profesionales de ciberseguridad", fr: "Professionnels de la cybersécurité", aliases: ["安全人员", "安全从业者", "安防", "网络安全"] },
  { key: "legal", zh: "法律界", en: "Legal Professionals", ja: "法律専門家", es: "Profesionales legales", fr: "Juristes", aliases: ["法律从业者", "法务", "律师", "法律人士"] },
  { key: "job_seekers", zh: "求职者", en: "Job Seekers", ja: "求職者", es: "Solicitantes de empleo", fr: "Demandeurs d'emploi", aliases: ["打工人", "职场人", "从业人员"] },
  { key: "industry", zh: "行业", en: "Industries", ja: "業界", es: "Industrias", fr: "Industries", aliases: ["产业", "相关行业", "垂直行业"] },
  { key: "open_source", zh: "开源社区", en: "Open Source Community", ja: "オープンソースコミュニティ", es: "Comunidad de código abierto", fr: "Communauté open source", aliases: ["开源", "开源生态", "开发者社区"] },
  { key: "chinese_audience", zh: "中文用户", en: "Chinese Users", ja: "中国のユーザー", es: "Usuarios chinos", fr: "Utilisateurs chinois", aliases: ["中文受众", "中文读者", "国内受众", "国内用户", "华语用户"] },
  { key: "english_audience", zh: "英语用户", en: "English Users", ja: "英語ユーザー", es: "Usuarios de habla inglesa", fr: "Utilisateurs anglophones", aliases: ["英语受众", "英文受众", "海外受众", "English audience", "海外用户"] },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, "");
}

const LOOKUP = new Map<string, AudienceEntry>();
for (const e of TAXONOMY) {
  const forms = [e.zh, e.en, e.ja, e.es, e.fr, ...(e.aliases ?? [])];
  for (const f of forms) {
    const n = norm(f);
    if (n) LOOKUP.set(n, e);
  }
}

/** 把受众名映射到指定 locale 的受控标签；未命中词表则原样返回（不破坏已翻译内容）。 */
export function localizeAudience(
  audience: string | null | undefined,
  locale: string,
): string {
  if (!audience) return audience ?? "";
  const entry = LOOKUP.get(norm(audience));
  if (!entry) return audience.trim();
  if (locale === "zh") return entry.zh;
  if (locale === "en") return entry.en;
  if (locale === "ja") return entry.ja;
  if (locale === "es") return entry.es;
  if (locale === "fr") return entry.fr;
  return entry.en;
}
