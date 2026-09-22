"use client";

import { isLocalPreview, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { PlatformCards, PlansGrid } from "@/src/components/Grids";
import { Icon } from "@/src/components/Icon";
import { StoreBadges } from "@/src/components/StoreBadges";

export default function Home() {
  const t = useT();
  const preview = isLocalPreview();
  const href = (path: string) => (preview ? previewHref(path) : path);

  return (
    <main>
      <SiteHeader />
      <section className="hero-dark">
        <div className="hero-inner">
          <div>
            <p className="eyebrow">{t("home.eyebrow")}</p>
            <h1 className="hero-title">{t("home.heroTitle1")}<br /><em>{t("home.heroTitle2")}</em></h1>
            <p className="hero-lead">{t("home.heroLead")}</p>
            <div className="hero-actions">
              <a className="btn btn-primary" href={href("/register")}>{t("home.ctaPrimary")} <span className="arrow" aria-hidden>→</span></a>
              <a className="btn btn-ghost" href={href("/platforms")}>{t("home.ctaSecondary")}</a>
            </div>
            <div className="hero-store">
              <StoreBadges />
            </div>
          </div>
          <div className="hero-art">
            <img src="/hero-worlds.webp" alt="From Zero To Hero" />
            <span className="hero-art-caption">FROM ZERO TO HERO</span>
          </div>
        </div>
      </section>

      <div className="trust-strip">
        <div className="trust-item"><span className="trust-icon"><Icon name="zap" size={19} /></span><div><strong>{t("home.trust1t")}</strong><small>{t("home.trust1d")}</small></div></div>
        <div className="trust-item"><span className="trust-icon"><Icon name="user" size={19} /></span><div><strong>{t("home.trust2t")}</strong><small>{t("home.trust2d")}</small></div></div>
        <div className="trust-item"><span className="trust-icon"><Icon name="infinity" size={19} /></span><div><strong>{t("home.trust3t")}</strong><small>{t("home.trust3d")}</small></div></div>
      </div>

      <section className="section-light" id="platforms">
        <div className="section-inner">
          <div className="section-head">
            <div>
              <h2>{t("home.platformsTitle")}</h2>
              <p>{t("home.platformsLead")}</p>
            </div>
            <a className="section-link" href={href("/platforms")}>{t("home.platformsLink")} →</a>
          </div>
          <PlatformCards />
        </div>
      </section>

      <section className="section-light" id="how" style={{ paddingTop: 0 }}>
        <div className="section-inner">
          <div className="section-head">
            <div>
              <h2>{t("home.howTitle")}</h2>
              <p>{t("home.howLead")}</p>
            </div>
          </div>
          <div className="how-steps">
            {[1, 2, 3].map((step) => (
              <div className="how-step" key={step}>
                <span className="how-step-num"><Icon name={step === 1 ? "user" : step === 2 ? "crown" : "grid"} size={20} /></span>
                <div><strong>{t(`home.step${step}t`)}</strong><p>{t(`home.step${step}d`)}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-light" id="plans" style={{ paddingTop: 0 }}>
        <div className="section-inner">
          <div className="section-head">
            <div>
              <h2>{t("home.plansTitle")}</h2>
              <p>{t("home.plansLead")}</p>
            </div>
            <a className="section-link" href={href("/pricing")}>{t("home.plansCta")} →</a>
          </div>
          <PlansGrid onChoose={() => { window.location.href = href("/pricing"); }} />
          <p className="page-note">{t("pricing.note")}</p>
        </div>
      </section>

      <section className="hero-dark">
        <div className="final-cta">
          <h2>{t("home.finalTitle1")} <em>{t("home.finalTitle2")}</em></h2>
          <p>{t("home.finalLead")}</p>
          <a className="btn btn-primary" href={href("/register")}>{t("home.finalCta")} <span className="arrow" aria-hidden>→</span></a>
        </div>
      </section>
      <SiteFooter />
    </main>
  );
}
