import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Header } from "@/components/header";

const SITE_URL = "https://aihot.cataito.com";

const OG_LOCALES: Record<string, string> = {
  en: "en_US",
  zh: "zh_CN",
  ja: "ja_JP",
  es: "es_ES",
  fr: "fr_FR",
};

export const runtime = "edge";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "site" });
  const ta = await getTranslations({ locale, namespace: "about" });
  return {
    title: ta("title"),
    description: ta("subtitle"),
    openGraph: {
      title: ta("title"),
      description: ta("subtitle"),
      url: `${SITE_URL}/${locale}/about`,
      type: "website",
      siteName: t("titleSuffix"),
      locale: OG_LOCALES[locale] ?? locale,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: t("title") }],
    },
    twitter: {
      card: "summary_large_image",
      title: ta("title"),
      description: ta("subtitle"),
      images: ["/og-image.png"],
    },
  };
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="about-section card">
      <h2>{title}</h2>
      <div className="about-body">{children}</div>
    </section>
  );
}

export default async function AboutPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "site" });
  const ta = await getTranslations({ locale, namespace: "about" });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: ta("title"),
    description: ta("subtitle"),
    url: `${SITE_URL}/${locale}/about`,
    inLanguage: locale,
    mainEntity: {
      "@type": "Organization",
      name: locale === "zh" ? "AI 热点简报" : "AI Hot Takes",
      url: SITE_URL,
      sameAs: ["https://github.com/cataito-lab/aihot"],
      contactPoint: {
        "@type": "ContactPoint",
        email: "hello@cataito.com",
        contactType: "customer support",
      },
      address: {
        "@type": "PostalAddress",
        addressCountry: "CN",
      },
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main className="site-main about-main">
        <div className="hero-section">
          <span className="signal-tag">{ta("tag")}</span>
          <h1>{ta("title")} <span className="text-fg-muted">/</span></h1>
          <p className="hero-desc">{ta("subtitle")}</p>
        </div>

        <div className="about-grid">
          <Section title={ta("what")}>
            <p>{ta("whatText")}</p>
          </Section>

          <Section title={ta("data")}>
            <p>{ta("dataText")}</p>
          </Section>

          <Section title={ta("scoring")}>
            <p>{ta("scoringText")}</p>
            <div className="about-tiers">
              <span className="tier-demo tier-major">
                <span className="tier-dot" aria-hidden />
                <span>Major</span>
                <span className="tier-num">≥80</span>
              </span>
              <span className="tier-demo tier-important">
                <span className="tier-dot" aria-hidden />
                <span>Important</span>
                <span className="tier-num">65–79</span>
              </span>
              <span className="tier-demo tier-normal">
                <span className="tier-dot" aria-hidden />
                <span>Normal</span>
                <span className="tier-num">&lt;65</span>
              </span>
            </div>
          </Section>

          <Section title={ta("privacy")}>
            <p>{ta("privacyText")}</p>
          </Section>

          <Section title={ta("lang")}>
            <p>{ta("langText")}</p>
            <div className="about-locale-pills">
              <span>en</span>
              <span>zh</span>
              <span>ja</span>
              <span>es</span>
              <span>fr</span>
            </div>
          </Section>

          <Section title={ta("team")}>
            <p>{ta("teamText")}</p>
            <div className="about-links">
              <a href="https://cataito.com" target="_blank" rel="noopener noreferrer">
                cataito.com
              </a>
              <span className="about-sep" aria-hidden>·</span>
              <a href="mailto:hello@cataito.com">hello@cataito.com</a>
              <span className="about-sep" aria-hidden>·</span>
              <a
                href="https://github.com/cataito-lab/aihot"
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/cataito-lab/aihot
              </a>
            </div>
          </Section>
        </div>

        <footer className="pb-10 pt-6 border-t border-line/60">
          <p className="text-center text-xs text-fg-muted">
            <span className="font-semibold text-fg">{t("titleSuffix")}</span>
            <span> — {ta("team")}</span>
          </p>
        </footer>
      </main>
    </>
  );
}