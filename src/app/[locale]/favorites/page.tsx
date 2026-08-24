import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/header";
import { TzNote } from "@/components/tz-note";
import FavoritesClient from "./client";

export const runtime = "edge";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: "Favorites",
    alternates: { canonical: `/${locale}/favorites` },
    robots: { index: false, follow: true },
  };
}

export default async function FavoritesPage() {
  const t = await getTranslations("home");
  return (
    <>
      <Header />
      <main className="site-main">
        <FavoritesClient />
      </main>
      <footer className="pb-10 pt-6 border-t border-line/60">
        <p className="text-center text-xs text-fg-muted">
          <span className="font-semibold text-fg">{t("footerBrand")}</span>
          {t("footerNote")},{" "}
          <a href="https://cataito.com" className="hover:text-accent transition-colors">
            Cataito
          </a>
          {t("footerSource")}
        </p>
        <TzNote />
      </footer>
    </>
  );
}
