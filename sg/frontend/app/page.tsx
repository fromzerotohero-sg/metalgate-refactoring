"use client";

import { isLocalPreview, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { PlatformCards } from "@/src/components/Grids";
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
          </div>
        </div>
      </section>

      <div className="trust-strip">
        <div className="trust-item"><span className="trust-icon"><Icon name="sparkles" size={19} /></span><div><strong>{t("home.trust1t")}</strong><small>{t("home.trust1d")}</small></div></div>
        <div className="trust-item"><span className="trust-icon"><Icon name="gem" size={19} /></span><div><strong>{t("home.trust2t")}</strong><small>{t("home.trust2d")}</small></div></div>
        <div className="trust-item"><span className="trust-icon"><Icon name="chart" size={19} /></span><div><strong>{t("home.trust3t")}</strong><small>{t("home.trust3d")}</small></div></div>
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

      <section className="section-light" id="features" style={{ paddingTop: 0 }}>
        <div className="section-inner">
          <div className="section-head">
            <div>
              <h2>{t("home.featuresTitle")}</h2>
              <p>{t("home.featuresLead")}</p>
            </div>
          </div>
          <div className="feat-list">
            {[1, 2, 3, 4, 5].map((feature) => (
              <div className="feat-item" key={feature}>
                <span className="feat-num" aria-hidden>{String(feature).padStart(2, "0")}</span>
                <div><strong>{t(`home.feat${feature}t`)}</strong><p>{t(`home.feat${feature}d`)}</p></div>
              </div>
            ))}
          </div>
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
                <span className="how-step-num"><Icon name={step === 1 ? "user" : step === 2 ? "grid" : "chart"} size={20} /></span>
                <div><strong>{t(`home.step${step}t`)}</strong><p>{t(`home.step${step}d`)}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-light" id="plans" style={{ paddingTop: 0 }}>
        <div className="section-inner">
          <div className="try-banner">
            <div>
              <h2>{t("home.tryTitle")}</h2>
              <p>{t("home.tryLead")}</p>
            </div>
            <div className="try-actions">
              <a className="btn btn-primary" href={href("/register")}>{t("home.tryCta")} <span className="arrow" aria-hidden>→</span></a>
              <a className="try-plans-link" href={href("/pricing")}>{t("home.tryPlans")}</a>
            </div>
          </div>
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
