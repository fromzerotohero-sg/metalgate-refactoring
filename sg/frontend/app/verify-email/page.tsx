"use client";

import { useEffect, useState } from "react";
import { api, ApiError, resolveReturnTarget } from "@/src/lib/api";
import { isLocalPreview } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";

export default function VerifyEmailPage() {
  const t = useT();
  const [message, setMessage] = useState(t("verifyEmail.working"));

  useEffect(() => {
    if (isLocalPreview()) { setMessage(t("verifyEmail.ok")); return; }

    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) { setMessage(t("verifyEmail.missing")); return; }

    // Where to go once verified. The registration and login flows pass
    // `redirect` through to the backend, which puts it on the emailed link — so a
    // user who came from a platform is sent back INTO that platform rather than
    // being dropped on the account page.
    //
    // Resolved on the server, not here: a registered platform origin is a valid
    // destination and an arbitrary URL is not, and this value arrives on a link
    // that was emailed to the user, so it must not be trusted locally.
    const requested = params.get("redirect");

    api.verifyEmail(token)
      .then(async () => {
        setMessage(t("verifyEmail.ok"));
        const destination = await resolveReturnTarget(requested);
        // 900ms is enough to read the confirmation, short enough not to feel stuck.
        setTimeout(() => window.location.assign(destination), 900);
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
