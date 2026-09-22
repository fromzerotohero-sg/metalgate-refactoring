"use client";

import { useEffect, useState } from "react";
import { api, type Plan } from "@/src/lib/api";
import { isLocalPreview, previewHref, previewPlans } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { Icon, type IconName } from "./Icon";

const PLATFORMS = [
  { key: "efootball", tone: "tone-blue", badge: "platform.live", href: "/login", img: "/cards/efootball.jpg", credit: "“Night begins to fall over Cardiff City Stadium” — joncandy, CC BY-SA 2.0" },
  { key: "arena", tone: "tone-violet", badge: "platform.community", href: "/register", img: "/cards/arena.jpg", credit: "“DSC_0271” — ZoneESports, CC BY 2.0" },
  { key: "league", tone: "tone-slate", badge: "platform.soon", href: "/register", img: "/cards/league.jpg", credit: "“Gaming computer keyboard RGB” — karlhols, CC BY 2.0" }
];

const PLAN_ICONS: Record<string, IconName> = { lite: "sprout", pro: "crown", ultra: "gem" };
const PLAN_FEATURES: Record<string, string[]> = {
  lite: ["pricing.feat1", "pricing.feat2", "pricing.feat3"],
  pro: ["pricing.featPro1", "pricing.featPro2", "pricing.featPro3"],
  ultra: ["pricing.featUltra1", "pricing.featUltra2", "pricing.featUltra3"]
};

export function PlatformCards({ showCredits = false }: { showCredits?: boolean }) {
  const t = useT();
  const preview = isLocalPreview();
  return (
    <>
      <div className="platforms-grid">
        {PLATFORMS.map((platform) => (
          <a className={`platform-card ${platform.tone}`} href={preview ? previewHref(platform.href) : platform.href} key={platform.key}>
            <img className="platform-card-img" src={platform.img} alt="" loading="lazy" />
            <span className="platform-card-overlay" aria-hidden />
            <span className="platform-badge">{t(platform.badge)}</span>
            <h3>{t(`platform.${platform.key}.name`)}</h3>
            <p>{t(`platform.${platform.key}.desc`)}</p>
            <span className="platform-tags">{t(`platform.${platform.key}.tags`)}</span>
            <span className="platform-arrow" aria-hidden>→</span>
          </a>
        ))}
      </div>
      {showCredits && (
        <p className="image-credits">Foto: {PLATFORMS.map((platform) => platform.credit).join(" · ")}</p>
      )}
    </>
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
