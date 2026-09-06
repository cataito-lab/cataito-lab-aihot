import { getTranslations } from "next-intl/server";
import { V2Header } from "@/components/v2/v2-header";
import "../../v2.css";

export default function V2Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="v2-root">
      <V2Header />
      {children}
      <V2Footer />
    </div>
  );
}

async function V2Footer() {
  const tHome = await getTranslations("home");
  return (
    <footer className="v2-footer">
      {tHome("footerBrand")}
      {tHome("footerNote")}
      {tHome("footerSource")}
    </footer>
  );
}
