import type { Metadata } from "next";

export const runtime = "edge";
export const metadata: Metadata = {
  title: "404 — Not found · AIHOT",
  description: "The page you requested does not exist. Try /en or see the sitemap.",
};

/**
 * Root-level 404 for aihot.cataito.com.
 *
 * Agents that fetch a nonexistent path must get a real HTTP 404 (never 200
 * with the app shell). The App Router's `not-found.tsx` plus `notFound()`
 * guarantees the wire status code; the body below is terse, link-dense
 * content so both human browsers and text-based agents can recover quickly.
 *
 * Also rendered when a locale segment is missing/invalid and falls through
 * from `[locale]/layout.tsx` — the `[locale]/not-found.tsx` path is not
 * needed because any path that does not match the app router falls here.
 */
export default function NotFound() {
  return (
    <html lang="en">
      <body className="not-found-body">
        <div className="not-found-wrap">
          <div className="nf-status">
            <span className="nf-code">404</span>
            <span className="nf-reason">Not found</span>
          </div>
          <p className="nf-intro">
            The page you requested does not exist on AIHOT.
          </p>

          <h2 className="nf-h">If you are an AI agent, try one of these:</h2>
          <ul className="nf-links">
            <li>
              <a href="/en">Home — rolling AI news timeline (English)</a>
            </li>
            <li>
              <a href="/zh">Home — 中文</a>
            </li>
            <li>
              <a href="/en?sort=importance">Top AI news this week by importance</a>
            </li>
            <li>
              <a href="/en/daily">Daily briefing archive</a>
            </li>
            <li>
              <a href="/llms.txt">Agent instructions (when-to-use + routes + params)</a>
            </li>
            <li>
              <a href="/sitemap.xml">Sitemap (~591 URLs)</a>
            </li>
            <li>
              <a href="/en/rss.xml">RSS feed (English)</a>
            </li>
            <li>
              <a href="/en/about">About AIHOT</a>
            </li>
          </ul>

          <h2 className="nf-h">Supported URL patterns</h2>
          <pre className="nf-pre">
{`/en                       Home (default locale)
/en | /zh | /ja | /es | /fr     Locale pickers
/en?category=llm               Filter by category
/en?sort=importance            Sort by AIHOT score
/en/daily                      Daily briefing index
/en/daily/2026-09-01           Specific date
/en/event/<key>                Event deep-dive
/en/entity/<slug>              Entity view
/en/favorites                  Saved items
/llms.txt                      Agent instructions
/sitemap.xml                   Sitemap
/robots.txt                    Crawler policy
/{en|zh|ja|es|fr}/rss.xml      RSS feeds`}
          </pre>

          <div className="nf-meta">
            <p>
              Source of truth for agent behavior:{" "}
              <a href="/llms.txt">/llms.txt</a>. Full route index:{" "}
              <a href="/sitemap.xml">/sitemap.xml</a>.
            </p>
            <p>
              Site: <a href="https://aihot.cataito.com">aihot.cataito.com</a> ·
              Built by <a href="https://cataito.com">Cataito</a>.
            </p>
          </div>
        </div>

        <style>{`
          html,body{margin:0;padding:0;background:#09090b;color:#fafafa;font-family:Inter,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
          .not-found-body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
          .not-found-wrap{max-width:720px;width:100%}
          .nf-status{display:flex;align-items:baseline;gap:1rem;margin-bottom:1.5rem}
          .nf-code{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:4rem;font-weight:700;line-height:1;color:#fb7185;letter-spacing:-.04em}
          .nf-reason{font-size:1.25rem;color:#a1a1aa}
          .nf-intro{font-size:1.1rem;color:#d4d4d8;margin:0 0 1.5rem}
          .nf-h{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#71717a;margin:1.5rem 0 .75rem}
          .nf-links{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:.5rem 1rem}
          .nf-links a{display:block;padding:.5rem .75rem;background:#18181b;border-radius:6px;color:#fafafa;text-decoration:none;font-size:.9rem}
          .nf-links a:hover{background:#27272a;color:#fb7185}
          .nf-pre{background:#18181b;color:#d4d4d8;font-family:'JetBrains Mono',ui-monospace,monospace;font-size:.78rem;line-height:1.7;padding:1rem;border-radius:8px;overflow-x:auto;white-space:pre}
          .nf-meta{margin-top:1.5rem;font-size:.8rem;color:#71717a;line-height:1.6}
          .nf-meta a{color:#fb7185;text-decoration:none}
          .nf-meta a:hover{text-decoration:underline}
          @media (max-width:640px){.nf-links{grid-template-columns:1fr}.nf-code{font-size:3rem}}
        `}</style>
      </body>
    </html>
  );
}