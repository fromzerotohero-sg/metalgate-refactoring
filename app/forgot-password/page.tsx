"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/src/lib/api";
import { isLocalPreview, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { Icon } from "@/src/components/Icon";

export default function ForgotPasswordPage() {
  const t = useT();
  const preview = isLocalPreview();
  const [email, setEmail] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") ?? "");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    if (preview) { setSent(true); setMessage(t("forgot.sent")); setBusy(false); return; }
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
      setMessage(t("forgot.sent"));
    } catch (error) {
      setMessage((error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <SiteHeader />
      <div className="auth-hero">
        <div className="auth-layout compact">
          <section className="auth-card">
            <p className="eyebrow dark">{t("forgot.eyebrow")}</p>
            <h1>{t("forgot.title")}</h1>
            <p className="auth-card-lead">{t("forgot.lead")}</p>
            {!sent ? (
              <form onSubmit={submit}>
                <div className="field">
                  <div className="field-input">
                    <span className="field-icon" aria-hidden><Icon name="mail" size={16} /></span>
                    <input type="email" autoComplete="email" required placeholder={t("login.emailPh")} value={email} onChange={(event) => setEmail(event.target.value)} />
                  </div>
                </div>
                {message && <p className="form-error" role="alert">{message}</p>}
                <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t("forgot.sending") : t("forgot.submit")} <span className="arrow" aria-hidden>→</span></button>
              </form>
            ) : (
              <>
                <div className="mail-note"><strong>{t("forgot.checkInbox")}</strong><span>{message}</span></div>
                <a className="btn btn-primary btn-block" href={previewHref(`/verify-code?email=${encodeURIComponent(email.trim())}`)}>{t("forgot.enterCode")} <span className="arrow" aria-hidden>→</span></a>
              </>
            )}
            <p className="auth-switch"><a href={preview ? previewHref("/login") : "/login"}>{t("forgot.backLogin")}</a></p>
          </section>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
