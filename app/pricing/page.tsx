"use client";

import { useState } from "react";
import { api, ApiError, type Plan } from "@/src/lib/api";
import { isLocalPreview } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { PlansGrid } from "@/src/components/Grids";

export default function PricingPage() {
  const t = useT();
  const [message, setMessage] = useState("");

  function choose(plan: Plan) {
    if (isLocalPreview()) { setMessage(t("pricing.demoCheckout")); return; }
    setMessage("");
    api.subscribe(plan.id)
      .then((result) => { window.location.href = result.url; })
      .catch((error: ApiError) => {
        if (error.status === 401) { window.location.href = "/login?return_to=/pricing"; return; }
        setMessage(error.message || t("common.error"));
      });
  }

  return (
    <main className="light-page">
      <SiteHeader />
      <section className="page-hero">
        <p className="eyebrow">{t("pricing.eyebrow")}</p>
        <h1>{t("pricing.title")}</h1>
        <p>{t("pricing.lead")}</p>
      </section>
      <div className="page-body">
        {message && <p className="form-error" role="alert" style={{ marginBottom: 22 }}>{message}</p>}
        <PlansGrid onChoose={choose} />
        <p className="page-note">{t("pricing.note")}</p>
      </div>
      <SiteFooter />
    </main>
  );
}
