"use client";

import { isLocalPreview, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";

export default function NotFound() {
  const t = useT();
  const home = isLocalPreview() ? previewHref("/") : "/";
  return (
    <main className="auth-page">
      <SiteHeader />
      <div className="auth-hero">
        <div className="full-screen-center">
          <p className="eyebrow">404</p>
          <h1 className="hero-title" style={{ fontSize: "clamp(30px, 4vw, 44px)" }}>{t("notFound.title")}</h1>
          <p style={{ color: "rgba(255,255,255,0.75)", maxWidth: 420 }}>{t("notFound.body")}</p>
          <a className="btn btn-primary" href={home}>{t("notFound.cta")} <span className="arrow" aria-hidden>→</span></a>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
