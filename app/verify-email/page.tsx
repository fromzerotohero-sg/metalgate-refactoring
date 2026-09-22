"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/src/lib/api";
import { isLocalPreview } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";

export default function VerifyEmailPage() {
  const t = useT();
  const [message, setMessage] = useState(t("verifyEmail.working"));

  useEffect(() => {
    if (isLocalPreview()) { setMessage(t("verifyEmail.ok")); return; }
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) { setMessage(t("verifyEmail.missing")); return; }
    api.verifyEmail(token)
      .then(() => {
        setMessage(t("verifyEmail.ok"));
        setTimeout(() => window.location.assign("/account"), 900);
      })
      .catch((error: ApiError) => setMessage(error.message || t("verifyEmail.fail")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="auth-page">
      <SiteHeader />
      <div className="auth-hero">
        <div className="auth-layout compact">
          <section className="auth-card" style={{ textAlign: "center" }}>
            <img src="/logo.webp" alt="From Zero To Hero" style={{ width: 52, height: 52, borderRadius: 12, margin: "0 auto 18px" }} />
            <h1 style={{ fontSize: 20 }}>{message}</h1>
          </section>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
