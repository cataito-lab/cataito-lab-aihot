import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#06070b" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "AI Hot Takes · Global AI News Timeline",
    template: "%s · AI Hot Takes",
  },
  description:
    "Real-time aggregation and summaries of global AI news from official blogs, English and Chinese media, and community discussions.",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark");}catch(e){}})()`;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(routing.locales as readonly string[]).includes(locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen flex flex-col antialiased">
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="animate-drift absolute -top-48 left-[10%] h-[480px] w-[480px] rounded-full bg-[#2563eb] opacity-[0.05] blur-[140px] dark:opacity-[0.10]" />
          <div className="animate-drift absolute -top-28 right-[6%] h-[400px] w-[400px] rounded-full bg-[#7c3aed] opacity-[0.04] blur-[140px] dark:opacity-[0.08]" style={{ animationDelay: "-7s" }} />
        </div>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}