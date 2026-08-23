import { getTranslations } from "next-intl/server";
import { Header } from "@/components/header";
import FavoritesClient from "./client";

export const runtime = "edge";

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
      </footer>
    </>
  );
}
