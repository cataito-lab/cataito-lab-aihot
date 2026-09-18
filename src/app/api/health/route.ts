import { getDb } from "@/lib/db";

export const runtime = "edge";

// 调度链 watchdog（见 docs/OPERATIONS.md §10）：
// 只读 fetch_logs 最近一次「成功且已完成」的抓取运行时间。update-news 目标节奏
// 是每 10 分钟一次；超过 25 分钟无成功运行即视为调度链疑似死亡，返回 503。
// 外部监控（cron-job.org 的 Check/监控任务，或 UptimeRobot 免费档）打这个 URL
// 即可在断流发生的第一个半小时内收到告警，而不是三天后翻 Actions 才发现。
//
// 注意：--enrich-only 不写 fetch_logs（见 pipeline/src/index.ts 注释），
// 因此这里监控到的严格是「抓取链」，不会被 enrich 运行掩盖抓取断流。
const STALE_MS = 25 * 60 * 1000;

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
    const healthy = ageMin !== null && ageMin <= STALE_MS / 60_000;

    return Response.json(
      {
        ok: healthy,
        scheduleTargetMinutes: 10,
        staleAfterMinutes: STALE_MS / 60_000,
        lastSuccessAt,
        minutesSinceLastSuccess: ageMin,
        lastRunId: row ? String(row.run_id) : null,
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
