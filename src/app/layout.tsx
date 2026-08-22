import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI 热点简报 · AI 行业动态时间线",
    template: "%s · AI 热点简报",
  },
  description:
    "全球 AI 行业热点自动聚合与摘要：官方博客、中英文媒体、社区讨论，按事件时间倒序的时间线简报，附信源可查证原文。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#06070b" },
  ],
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen flex flex-col antialiased">
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="animate-drift absolute -top-48 left-[10%] h-[480px] w-[480px] rounded-full bg-[#2563eb] opacity-[0.05] blur-[140px] dark:opacity-[0.10]" />
          <div
            className="animate-drift absolute -top-28 right-[6%] h-[400px] w-[400px] rounded-full bg-[#7c3aed] opacity-[0.04] blur-[140px] dark:opacity-[0.08]"
            style={{ animationDelay: "-7s" }}
          />
        </div>
        {children}
      </body>
    </html>
  );
}
