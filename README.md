# AI Hot Takes（AI 热点简报）

公开的 AI 行业新闻聚合站：**https://aihot.cataito.com**

GitHub Actions 定时抓取约 20 个中英文 AI 信源 → 标题自动翻译、重点新闻 AI 摘要（Cloudflare Workers AI）→ 写入 Turso 云数据库 → Next.js 按事件时间倒序展示。

## 功能

- Techmeme 式紧凑时间流，小时分组 + 「今日/昨日」标记，按访客本地时区渲染
- 英文标题自动译中，双语对照；重点新闻多语言 AI 摘要
- FTS 搜索（中英文子串）、分类/信源筛选、收藏（localStorage）
- 对外输出 RSS：`/rss.xml`；5 语言界面（en / zh / ja / es / fr）
- 跨源事件聚类：同一事件的多家报道合并为事件卡（标注「N 家媒体」+ 各源链接 + 事件级综合摘要）；每个事件生成独立详情页 `/event/[key]`（SSR + schema.org JSON-LD + sitemap，利于 SEO）
- 数据永久保存，支持回溯

## 架构

```
GitHub Actions (cron 0 8-22 * * *)
  └─ pipeline/src：fetch → dedup(sha1) → filter → translate → summarize
        └─ Turso (libSQL)：articles / sources / events / fetch_logs / FTS
              └─ Next.js App Router @ Cloudflare Pages（edge runtime）
                   / · /event/[key] · /api/news · /api/sources · /rss.xml · /sitemap.xml
```

技术细节见 [docs/TECH_SPEC.md](docs/TECH_SPEC.md)，执行与交接见 [docs/HANDOFF.md](docs/HANDOFF.md)。

## 本地开发

```bash
npm install

cp .env.example .env.local   # 填入 Turso 凭据（可选，缺省落本地 sqlite data/local.db）

npx tsx pipeline/src/index.ts --window-hours 24 --dry-run  # 抓取管线 dry-run
npm run dev                 # http://localhost:3000
npm run build               # 生产构建
```

- 环境：Node 20+；抓取管线走 `pipeline/src/net.ts` 的 httpFetch（支持代理环境变量）
- 数据库初始化：`npm run db:init`；查看数据：`npx tsx pipeline/scripts/inspect-db.ts`

## 部署

- 前端：Cloudflare Pages（`@cloudflare/next-on-pages` 适配），绑定域名 `aihot.cataito.com`
- 数据：Turso（libSQL）；凭据配在 GH Actions secrets 与 CF Pages 环境变量
- 抓取：`.github/workflows/update-news.yml`，全天候每小时整点运行
