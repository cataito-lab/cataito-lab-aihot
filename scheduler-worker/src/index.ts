/**
 * aihot-news-scheduler — Cloudflare Worker Cron Triggers（2026-09-18 重建版）
 *
 * 职责：作为 GitHub Actions 不可靠 schedule 的外部主链路定时器，
 * 每 10 分钟 POST repository_dispatch 触发 update-news（event_type=run-pipeline），
 * 每 30 分钟顺带触发 enrich-news（event_type=run-enrich）。
 * （cron 表达式见同目录 wrangler.toml；注意 cron 的分钟通配写法含「星+斜杠」
 * 两字符序列，不能原样写进本块注释，否则会提前闭合注释——已知坑。）
 *
 * 相比旧版（git 历史 9ef8ad7^，线上最终版另有 fetch 测试入口）的四处修正：
 *   1. workflow_dispatch → repository_dispatch：无 inputs/ref 参数面，
 *      不存在「参数不匹配 → 404/422 触发静默丢弃」故障类；
 *   2. 裸 await → ctx.waitUntil：官方模式，杜绝 handler 提前结算导致外呼被丢弃；
 *   3. 每次外呼的状态码无条件记录：断流时 Request logs 一眼可诊（旧版失败才打日志，
 *      且没人看 Worker 日志）；
 *   4. 保留 fetch 手动测试入口（访问 Worker URL 即发一拍并返回状态码文本），
 *      但修掉旧版「204 带 body 抛 TypeError」的 bug，改返回 200 纯文本。
 *
 * 历史死因（2026-09-18 已在 CF 控制台现场确证）：代码与 PAT 均存活（手动访问
 * Worker URL 实测 GitHub 返回 status=204），真正死因是 **Cron Trigger 配置丢失**，
 * scheduled handler 从未被调度。教训：Worker「部署」与「cron 配置」是两个独立状态，
 * 重建/重新部署 Worker 后 cron 不会自动回来，必须去 Settings → Triggers 亲眼确认。
 *
 * 部署（推荐 wrangler CLI，一次带齐代码+cron，避开网页编辑器所有坑）：
 *   cd scheduler-worker && npx wrangler login（或 CLOUDFLARE_API_TOKEN 环境变量）
 *   npx wrangler deploy          ← 上传 src/index.ts 并应用 wrangler.toml 的 [triggers] cron
 *   npx wrangler secret put GITHUB_TOKEN
 *   ⚠️ 国内网络：api.cloudflare.com 实测直连可通，但若挂了代理软件（TUN 模式）反而会让
 *   wrangler fetch failed，去掉代理环境变量即可；网页编辑器操作路径见 git 历史版注释。
 * 验证：
 *   1. 访问 Worker URL（fetch 测试入口）应立即返回 `run-pipeline=204 | run-enrich=204`；
 *      403 Resource not accessible = PAT 缺 Contents: Read and write（不是 Actions！）；
 *   2. 注意在仓库 workflow 合入 repository_dispatch 触发器之前，204 不会产生 run（预期行为）；
 *      合入后 ≤10 分钟看 Actions 页出现 repository_dispatch 的 run 即链路闭合。
 */
export interface Env {
  // fine-grained PAT，需本仓库 Contents: Read and write（repository_dispatch 要求的权限类）。
  // 通过 wrangler secret put GITHUB_TOKEN 或 CF 面板设置，切勿提交。
  GITHUB_TOKEN: string;
  // 可选：覆盖默认仓库（owner/repo）
  REPO?: string;
}

// scheduled 事件的最小类型声明（避免依赖 @cloudflare/workers-types，网页编辑器直接可粘）
interface CronEvent {
  cron: string;
}
interface ExecutionCtx {
  waitUntil(promise: Promise<unknown>): void;
}

async function dispatchOnce(repo: string, token: string, eventType: string): Promise<string> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        // GitHub REST 硬要求非空 User-Agent，缺失直接 403
        "User-Agent": "aihot-news-scheduler",
      },
      body: JSON.stringify({ event_type: eventType }),
    });
    const text = await res.text().catch(() => "");
    // 成功为 204 No Content；一律记录状态码，不按具体数字判真假（res.ok 为准）
    return `${eventType}=${res.status}${res.ok ? "" : ` ${text.slice(0, 160)}`}`;
  } catch (err) {
    return `${eventType}=FETCH_ERROR ${(err as Error)?.message ?? "unknown"}`;
  }
}

const worker = {
  // 定时主链路：cron 每 10 分钟一拍
  async scheduled(_event: CronEvent, env: Env, ctx: ExecutionCtx): Promise<void> {
    const repo = env.REPO ?? "cataito-lab/cataito-lab-aihot";
    // CF cron */10 在 UTC 分钟 0,10,20,... 触发；落在 0/30 分的那一拍多带一个 enrich
    const fireEnrich = new Date().getUTCMinutes() % 30 === 0;
    const jobs = [dispatchOnce(repo, env.GITHUB_TOKEN, "run-pipeline")];
    if (fireEnrich) jobs.push(dispatchOnce(repo, env.GITHUB_TOKEN, "run-enrich"));
    // 官方模式：外呼挂到 waitUntil 上，handler 结算也不丢在途请求
    ctx.waitUntil(Promise.all(jobs).then((results) => {
      console.log(`[scheduler ${new Date().toISOString()}] ${results.join(" | ")}`);
    }));
  },

  // 手动测试入口（延续旧版设计）：浏览器访问 Worker URL 即发一拍并返回状态码文本，
  // PAT/仓库名/网络问题 3 秒可诊。必须用 200+body：CF 禁止 204 带 body（旧版在此抛 TypeError）。
  async fetch(_req: Request, env: Env): Promise<Response> {
    const repo = env.REPO ?? "cataito-lab/cataito-lab-aihot";
    const results = await Promise.all([
      dispatchOnce(repo, env.GITHUB_TOKEN, "run-pipeline"),
      dispatchOnce(repo, env.GITHUB_TOKEN, "run-enrich"),
    ]);
    return new Response(`dispatched: ${results.join(" | ")}\n`, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};

export default worker;
