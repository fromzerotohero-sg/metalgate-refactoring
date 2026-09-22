"use client";

import { isLocalPreview, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { StoreBadges } from "./StoreBadges";

export function SiteFooter() {
  const t = useT();
  const preview = isLocalPreview();
  const href = (path: string) => (preview ? previewHref(path) : path);

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand">
          <a className="brand" href={href("/")}>
            <img src="/logo.webp" alt="From Zero To Hero" />
            <span className="brand-name">From Zero To Hero</span>
          </a>
          <span className="footer-tagline">{t("footer.tagline")}</span>
        </div>
        <nav className="footer-nav" aria-label="Footer">
          <a href={href("/platforms")}>{t("nav.platforms")}</a>
          <a href={href("/pricing")}>{t("nav.pricing")}</a>
          <a href={href("/legal/terms")}>{t("footer.terms")}</a>
          <a href={href("/legal/privacy")}>{t("footer.privacy")}</a>
          {preview && <a href="/preview">{t("footer.preview")}</a>}
        </nav>
        <StoreBadges />
        <div className="footer-meta">
          <span>© {new Date().getFullYear()} {t("footer.rights")}</span>
          <span className="footer-company">Spazio Game Srls · Via Caduti sul Lavoro snc, 26029 Soncino (CR) · P.IVA IT 01625480197 · <a href="mailto:info@fromzerotohero.it">info@fromzerotohero.it</a></span>
          <span className="footer-payoff">{t("footer.payoff")}</span>
        </div>
      </div>
    </footer>
  );
}
