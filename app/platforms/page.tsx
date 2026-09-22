"use client";

import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { PlatformCards } from "@/src/components/Grids";

export default function PlatformsPage() {
  const t = useT();
  return (
    <main className="light-page">
      <SiteHeader />
      <section className="page-hero">
        <p className="eyebrow">{t("platforms.eyebrow")}</p>
        <h1>{t("platforms.title")}</h1>
        <p>{t("platforms.lead")}</p>
      </section>
      <div className="page-body">
        <PlatformCards />
      </div>
      <SiteFooter />
    </main>
  );
}
