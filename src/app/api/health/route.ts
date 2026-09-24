import { getDb } from "@/lib/db";

export const runtime = "edge";

// 调度链 watchdog（见 docs/OPERATIONS.md §10）：
// ① 抓取心跳——只读 fetch_logs 最近一次「成功且已完成」的抓取运行时间。update-news 目标节奏
//    是每 10 分钟一次；超过 25 分钟无成功运行即视为调度链疑似死亡，返回 503。
// ② 洞察心跳——2026-09-24 断流补上的检查：LLM 容灾链（Gemini + Workers AI 免费档）整点 429
//    时，Actions 可以连续几小时全绿而洞察零产出，2026-09-20~22 那次断流 48h 无人发现，
//    就是因为这里只覆盖了抓取链。
// 外部监控（cron-job.org 的 Check/监控任务，或 UptimeRobot 免费档）打这个 URL 即可收到告警。
//
// 注意：--enrich-only 不写 fetch_logs（见 pipeline/src/index.ts 注释），
// 因此①监控到的严格是「抓取链」，不会被 enrich 运行掩盖抓取断流。
const STALE_MS = 25 * 60 * 1000;

// 洞察断流阈值必须容忍一个完整的额度周期：两档免费额度都在太平洋零点（UTC 07:00）重置，
// 实测每天只有重置后约一小时真正产出洞察，"距上次洞察 24 小时"属于正常运行形态。
// 取 26h = 24h 周期 + 2h 余量；再高就会把真正的多日断流（如 09-20 那次）漏掉。
const INSIGHT_STALE_HOURS = 26;

export async function GET() {
  const headers = { "cache-control": "no-store" };
  try {
    const db = await getDb();
    // finished_at 由 pipeline 以 JS toISOString() 写入，字符串比较即时间序
    const res = await db.execute({
      sql: "SELECT run_id, finished_at, inserted FROM fetch_logs WHERE ok = 1 AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1",
      args: [],
    });
    const row = res.rows[0];
    const lastSuccessAt = row ? String(row.finished_at) : null;
    const ageMin = lastSuccessAt
      ? Math.round((Date.now() - new Date(lastSuccessAt).getTime()) / 60_000)
      : null;
    const fetchHealthy = ageMin !== null && ageMin <= STALE_MS / 60_000;

    // summarized_at 同样以 toISOString() 写入；只认 summary 非空的行，
    // 无正文被标记为「已处理但无摘要」的行（summary IS NULL）不算洞察产出。
    const ins = await db.execute({
      sql: "SELECT MAX(summarized_at) AS last_at FROM articles WHERE summary IS NOT NULL",
      args: [],
    });
    const lastInsightAt = ins.rows[0]?.last_at ? String(ins.rows[0].last_at) : null;
    const insightAgeHours = lastInsightAt
      ? Math.round((Date.now() - new Date(lastInsightAt).getTime()) / 3_600_000)
      : null;
    const insightHealthy =
      insightAgeHours !== null && insightAgeHours <= INSIGHT_STALE_HOURS;

    const healthy = fetchHealthy && insightHealthy;

    return Response.json(
      {
        ok: healthy,
        fetch: {
          ok: fetchHealthy,
          scheduleTargetMinutes: 10,
          staleAfterMinutes: STALE_MS / 60_000,
          lastSuccessAt,
          minutesSinceLastSuccess: ageMin,
          lastRunId: row ? String(row.run_id) : null,
        },
        insight: {
          ok: insightHealthy,
          staleAfterHours: INSIGHT_STALE_HOURS,
          lastGeneratedAt: lastInsightAt,
          hoursSinceLastGenerated: insightAgeHours,
        },
      },
      { status: healthy ? 200 : 503, headers },
    );
  } catch (err) {
    console.error("[api/health]", err);
    // DB 不可达同样报 503：对监控而言「读不到状态」与「状态异常」等价
    return Response.json(
      { ok: false, error: "database unreachable" },
      { status: 503, headers },
    );
  }
}
