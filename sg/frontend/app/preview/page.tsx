"use client";

import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";

const publicPages: [string, string][] = [
  ["page.home", "/"], ["page.platforms", "/platforms"], ["page.pricing", "/pricing"],
  ["page.login", "/login"], ["page.register", "/register"], ["page.forgot", "/forgot-password"],
  ["page.code", "/verify-code"], ["page.reset", "/reset-password"], ["page.verifyEmail", "/verify-email"],
  ["page.terms", "/legal/terms"], ["page.privacy", "/legal/privacy"]
];
const accountPages: [string, string][] = [
  ["page.overview", "/account"], ["page.profile", "/account/profile"],
  ["page.subscription", "/account/subscription"], ["page.security", "/account/security"], ["page.activity", "/account/transactions"]
];

export default function PreviewIndex() {
  const t = useT();
  return (
    <main className="light-page">
      <SiteHeader />
      <section className="page-hero">
        <p className="eyebrow">{t("preview.eyebrow")}</p>
        <h1>{t("preview.title")}</h1>
        <p>{t("preview.lead")}</p>
      </section>
      <div className="page-body">
        <div className="preview-groups">
          <div>
            <p className="eyebrow dark">{t("preview.public")}</p>
            <nav className="preview-links">
              {publicPages.map(([label, href]) => <a className="preview-link" href={href} key={href}>{t(label)}<span aria-hidden>→</span></a>)}
            </nav>
          </div>
          <div>
            <p className="eyebrow dark">{t("preview.account")}</p>
            <nav className="preview-links">
              {accountPages.map(([label, href]) => <a className="preview-link" href={`${href}?preview=1`} key={href}>{t(label)}<span aria-hidden>↗</span></a>)}
              <a className="preview-link" href="/account?preview=1&subscription=success">{t("page.overview")} — subscription=success<span aria-hidden>↗</span></a>
            </nav>
          </div>
        </div>
        <p className="preview-hint">{t("preview.hint")}</p>
      </div>
      <SiteFooter />
    </main>
  );
}
