export interface Env {
  // GitHub fine-grained PAT，仅需 `actions:write`（作用于本仓库）。
  // 用 `wrangler secret put GITHUB_TOKEN` 设置，切勿提交。
  GITHUB_TOKEN: string;
  // 可选：覆盖默认仓库。
  REPO?: string;
}

export default {
  async scheduled(
    _event: unknown,
    env: Env,
    _ctx: unknown,
  ): Promise<void> {
    const repo = env.REPO ?? "cataito-lab/cataito-lab-aihot";
    const url = `https://api.github.com/repos/${repo}/actions/workflows/update-news/dispatches`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "aihot-scheduler-worker",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[scheduler] dispatch failed ${res.status}: ${text}`);
    } else {
      console.log("[scheduler] dispatched update-news");
    }
  },
};
