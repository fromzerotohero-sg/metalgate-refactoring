"use client";

import { useEffect, useState } from "react";
import { api, type Plan } from "@/src/lib/api";
import { isLocalPreview, previewHref, previewPlans } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { Icon, type IconName } from "./Icon";

const PLATFORMS: { key: string; tone: string; badge: string; href: string | null; img: string; external?: boolean }[] = [
  // efootball is a live product on its own host. It authenticates through SilverGate
  // and shares the brand session cookie, so this is an ordinary link into it rather
  // than a route on this site.
  { key: "efootball", tone: "tone-blue", badge: "platform.live", href: "https://efootball.fromzerotohero.io/", img: "/cards/efootball.webp", external: true },
  { key: "arena", tone: "tone-violet", badge: "platform.community", href: "/register", img: "/cards/arena.webp" },
  { key: "league", tone: "tone-slate", badge: "platform.soon", href: null, img: "/cards/league.webp" }
];

const PLAN_ICONS: Record<string, IconName> = { lite: "sprout", pro: "crown", ultra: "gem" };
const PLAN_FEATURES: Record<string, string[]> = {
  lite: ["pricing.feat1", "pricing.feat2", "pricing.feat3"],
  pro: ["pricing.featPro1", "pricing.featPro2", "pricing.featPro3"],
  ultra: ["pricing.featUltra1", "pricing.featUltra2", "pricing.featUltra3"]
};

export function PlatformCards() {
  const t = useT();
  const preview = isLocalPreview();
  return (
    <div className="platforms-grid">
      {PLATFORMS.map((platform) => {
        // An absolute href is a link off this site, so it must not have the local
        // preview flag appended to it.
        const href = platform.href && !platform.external && preview ? previewHref(platform.href) : platform.href;
        const content = (
          <>
            <img className="platform-card-img" src={platform.img} alt="" loading="lazy" />
            <span className="platform-card-overlay" aria-hidden />
            <span className="platform-badge">{t(platform.badge)}</span>
            <h3>{t(`platform.${platform.key}.name`)}</h3>
            <p>{t(`platform.${platform.key}.desc`)}</p>
            <span className="platform-tags">{t(`platform.${platform.key}.tags`)}</span>
            {href && <span className="platform-arrow" aria-hidden>{platform.external ? "↗" : "→"}</span>}
          </>
        );
        return href ? (
          <a className={`platform-card ${platform.tone}`} href={href} key={platform.key}>{content}</a>
        ) : (
          <div className={`platform-card ${platform.tone} soon`} key={platform.key}>{content}</div>
        );
      })}
    </div>
  );
}

export function PlansGrid({ onChoose }: { onChoose?: (plan: Plan) => void }) {
  const t = useT();
  const [plans, setPlans] = useState<Plan[]>(isLocalPreview() ? previewPlans : []);

  useEffect(() => {
    if (isLocalPreview()) { setPlans(previewPlans); return; }
    api.plans().then((data) => setPlans(data.plans ?? [])).catch(() => setPlans([]));
  }, []);

  if (!plans.length) return null;
  return (
    <div className="plans-grid">
      {plans.map((plan) => (
        <article className={`plan-card ${plan.id === "pro" ? "popular" : ""}`} key={plan.id}>
          {plan.id === "pro" && <span className="plan-popular-badge">{t("pricing.popular")}</span>}
          <span className="plan-icon" aria-hidden><Icon name={PLAN_ICONS[plan.id] ?? "sparkles"} size={26} /></span>
          <h3>{plan.name}</h3>
          <div className="plan-price">{plan.price_display ?? "—"}<small> {t("pricing.perMonth")}</small></div>
          <p className="plan-credits">{plan.credits_per_period ?? "—"} {t("pricing.creditsMonth")}</p>
          <ul className="plan-features">
            {(PLAN_FEATURES[plan.id] ?? PLAN_FEATURES.lite).map((feature) => <li key={feature}>{t(feature)}</li>)}
          </ul>
          <button className={`btn ${plan.id === "pro" ? "btn-primary" : "btn-outline"} btn-block`} onClick={() => onChoose?.(plan)}>
            {t("pricing.choose")}
          </button>
        </article>
      ))}
    </div>
  );
}
