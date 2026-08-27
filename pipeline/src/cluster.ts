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
} from "./db";
import { runModel, parseModelJson } from "./summarize";

const MAX_SYNTH_PER_RUN = 8;
/** 综合摘要也消耗 Workers AI 配额；给摘要调用留余量，避免突破每日上限 */
const DAILY_QUOTA_HEADROOM = 180;

function bestTitle(title: string, titleZh: string | null): { primary: string; secondary: string | null } {
  if (titleZh && titleZh !== title) return { primary: titleZh, secondary: title };
  return { primary: title, secondary: null };
}

export async function clusterEvents(windowHours: number): Promise<{ clustered: number; synthesized: number }> {
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

  console.log(`  [cluster] clustered=${clustered} synthesized=${synthesized}`);
  return { clustered, synthesized };
}
