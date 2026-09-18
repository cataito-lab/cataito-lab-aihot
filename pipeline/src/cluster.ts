import { randomUUID } from "node:crypto";
import {
  countSummariesToday,
  getUnclusteredArticles,
  findEventByKey,
  createEvent,
  assignArticleEvent,
  updateEventStats,
  getEventMembers,
  getUnsynthesizedEvents,
  saveEventSynthesis,
  getSingletonUnits,
  deleteSingletonEvent,
} from "./db";
import { runModel, parseModelJson } from "./summarize";

const MAX_SYNTH_PER_RUN = 8;
/** 综合摘要也消耗 LLM 每日配额（与 summarize 共用 countSummariesToday 口径）；给摘要调用留余量，避免突破每日上限 */
const DAILY_QUOTA_HEADROOM = 180;

/** 预聚类回看窗口（小时）：纳入更早的单源事件，供后续到达的同类报道认亲 */
const PRECLUSTER_WINDOW_HOURS = 72;
/** 标题 trigram 相似度阈值（Jaccard）：≥ 此值视为同一事件候选 */
const TRIGRAM_THRESHOLD = 0.45;
/** 同事件候选的发布时间差上限（小时）：超过则不合并（防跨日误合） */
const MAX_TIME_DIFF_HOURS = 48;

function bestTitle(title: string, titleZh: string | null): { primary: string; secondary: string | null } {
  if (titleZh && titleZh !== title) return { primary: titleZh, secondary: title };
  return { primary: title, secondary: null };
}

// ---------- 预聚类：跨渠道同文异 URL / LLM 漏打同 key 的单源事件合并 ----------

export function trigrams(text: string): Set<string> {
  const norm = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (norm.length < 3) return new Set();
  const out = new Set<string>();
  for (let i = 0; i <= norm.length - 3; i++) out.add(norm.slice(i, i + 3));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 双语相似度：同文种直比（en-en 与 zh-zh），取较大值；跨文种（en vs zh 原题）不比 */
function titleSimilarity(
  a: { title: string; titleZh: string | null },
  b: { title: string; titleZh: string | null },
): number {
  let best = jaccard(trigrams(a.title), trigrams(b.title));
  if (a.titleZh && b.titleZh) {
    best = Math.max(best, jaccard(trigrams(a.titleZh), trigrams(b.titleZh)));
  }
  return best;
}

interface SingletonUnit {
  id: string;
  eventId: string;
  hasEventRow: boolean;
  eventKey: string | null;
  title: string;
  titleZh: string | null;
  sourceId: string;
  scoreFinal: number | null;
  publishedAt: string;
}

/** 合并单源事件：按分数贪心成组（组内不得同源、须标题相似且时间接近），
 *  组员并入正主事件后删除被吸收的单源事件行。返回被并入的文章数。 */
export async function mergeSingletonEvents(): Promise<number> {
  const units = (await getSingletonUnits(PRECLUSTER_WINDOW_HOURS)).filter(
    (u) => u.hasEventRow && u.eventKey,
  );
  if (units.length < 2) return 0;

  const sorted = [...units].sort((x, y) => (y.scoreFinal ?? 0) - (x.scoreFinal ?? 0));
  const groups: Array<{ canonical: SingletonUnit; members: SingletonUnit[] }> = [];

  for (const u of sorted) {
    const uTime = Date.parse(u.publishedAt);
    let target: (typeof groups)[number] | null = null;
    for (const g of groups) {
      const all = [g.canonical, ...g.members];
      if (all.some((m) => m.sourceId === u.sourceId)) continue; // 同源标题撞车多半是系列文，不合
      if (!all.some((m) => titleSimilarity(u, m) >= TRIGRAM_THRESHOLD)) continue;
      const dtHours = Math.abs(Date.parse(g.canonical.publishedAt) - uTime) / 3_600_000;
      if (dtHours > MAX_TIME_DIFF_HOURS) continue;
      target = g;
      break;
    }
    if (target) target.members.push(u);
    else groups.push({ canonical: u, members: [] });
  }

  let merged = 0;
  for (const g of groups) {
    if (g.members.length === 0) continue;
    const absorbed = new Set<string>();
    for (const m of g.members) {
      if (m.eventId === g.canonical.eventId) continue;
      await assignArticleEvent(m.id, g.canonical.eventId);
      absorbed.add(m.eventId);
      merged++;
    }
    if (absorbed.size === 0) continue;
    const members = await getEventMembers(g.canonical.eventId);
    const sourceIds = new Set(members.map((m) => m.sourceId));
    const lastSeen = members.map((m) => m.publishedAt).sort()[members.length - 1] ?? g.canonical.publishedAt;
    await updateEventStats(g.canonical.eventId, {
      peakScore: members.reduce((acc, m) => Math.max(acc, m.scoreFinal ?? 0), g.canonical.scoreFinal ?? 0),
      sourceCount: sourceIds.size,
      lastSeen,
      title: g.canonical.title,
      titleZh: g.canonical.titleZh,
    });
    for (const eid of absorbed) await deleteSingletonEvent(eid);
    console.log(
      `  [precluster] +${g.members.length} into ${g.canonical.eventId.slice(0, 8)}: "${g.canonical.title.slice(0, 70)}"`,
    );
  }
  return merged;
}

export async function clusterEvents(windowHours: number): Promise<{ clustered: number; synthesized: number; merged: number }> {
  const rows = await getUnclusteredArticles(windowHours);
  let clustered = 0;

  for (const a of rows) {
    if (!a.eventKey) {
      // 非事件项（观点/综述等）：以自身 id 成组，避免每轮重复处理
      await assignArticleEvent(a.id, a.id);
      clustered++;
      continue;
    }
    const existing = await findEventByKey(a.eventKey);
    if (existing) {
      await assignArticleEvent(a.id, existing.id);
      await updateEventStats(existing.id, {
        peakScore: Math.max(existing.peakScore ?? 0, a.scoreFinal ?? 0),
        sourceCount: existing.sourceCount + 1,
        lastSeen: a.publishedAt,
        title: existing.title ?? a.title,
        titleZh: existing.titleZh ?? a.titleZh,
      });
    } else {
      const eid = randomUUID();
      await createEvent({
        id: eid,
        eventKey: a.eventKey,
        title: a.title,
        titleZh: a.titleZh,
        peakScore: a.scoreFinal,
        firstSeen: a.publishedAt,
      });
      await assignArticleEvent(a.id, eid);
    }
    clustered++;
  }

  // Phase 1.5：预聚类合并——LLM 给同一事件打了不同 event_key 时，
  // 用标题 trigram + 时间窗把单源事件归并，先于综合摘要执行，合并后即可按多源综合
  const merged = await mergeSingletonEvents();

  // Phase 2：对尚未综合的多源事件，调用一次 LLM 生成事件级综合摘要
  let synthesized = 0;
  const used = await countSummariesToday();
  if (used < DAILY_QUOTA_HEADROOM) {
    const events = await getUnsynthesizedEvents(MAX_SYNTH_PER_RUN);
    for (const ev of events) {
      if (synthesized >= MAX_SYNTH_PER_RUN) break;
      const members = await getEventMembers(ev.id);
      if (members.length < 2) {
        await saveEventSynthesis(ev.id, null, null);
        synthesized++;
        continue;
      }
      const text = members
        .map((m, i) => {
          const t = bestTitle(m.title, m.titleZh).primary;
          return `${i + 1}. [${m.sourceId}] ${m.summary ?? t}`;
        })
        .join("\n");
      const prompt = `你是 AI 行业新闻编辑。以下是关于同一事件的若干篇报道摘要，请综合成 JSON：{"summary":"2-3 句中文综合报道：先陈述事件核心事实，再说明对行业/企业/用户的影响","summary_en":"2-3 sentence English synthesis of the same event"}\n\n${text}`;
      let zh: string | null = null;
      let en: string | null = null;
      try {
        const raw = await runModel(prompt);
        const parsed = raw ? parseModelJson(raw) : null;
        if (parsed) {
          zh = typeof parsed.summary === "string" ? parsed.summary.trim() || null : null;
          en = typeof parsed.summary_en === "string" ? parsed.summary_en.trim() || null : null;
        }
      } catch (err) {
        console.warn(`  [cluster] synthesize ${ev.id} failed: ${err instanceof Error ? err.message : err}`);
      }
      await saveEventSynthesis(ev.id, zh, en);
      synthesized++;
    }
  }

  console.log(`  [cluster] clustered=${clustered} merged=${merged} synthesized=${synthesized}`);
  return { clustered, synthesized, merged };
}
