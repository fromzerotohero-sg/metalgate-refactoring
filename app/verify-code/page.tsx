"use client";

import { FormEvent, useState } from "react";
import { api, ApiError } from "@/src/lib/api";
import { isLocalPreview, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { Icon } from "@/src/components/Icon";

export default function VerifyCodePage() {
  const t = useT();
  const preview = isLocalPreview();
  const [email, setEmail] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") ?? "");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    if (preview) { window.location.href = previewHref("/reset-password?token=demo"); return; }
    try {
      const result = await api.verifyResetCode({ email: email.trim(), code: code.replace(/\D/g, "").slice(0, 6) });
      if (!result.reset_token) throw new Error(t("code.invalid"));
      window.location.href = `/reset-password?token=${encodeURIComponent(result.reset_token)}`;
    } catch (error) {
      setMessage((error as ApiError).message || t("code.invalid"));
      setBusy(false);
    }
  }

  async function resend() {
    if (!email.trim()) { setMessage(t("code.needEmail")); return; }
    setResending(true);
    setMessage("");
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
      setMessage(t("code.resent"));
    } catch (error) {
      setMessage((error as ApiError).message);
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="auth-page">
      <SiteHeader />
      <div className="auth-hero">
        <div className="auth-layout compact">
          <section className="auth-card">
            <p className="eyebrow dark">{t("code.eyebrow")}</p>
            <h1>{t("code.title")}</h1>
            <p className="auth-card-lead">{t("code.lead")}</p>
            <form onSubmit={submit}>
              <div className="field">
                <div className="field-input">
                  <span className="field-icon" aria-hidden><Icon name="mail" size={16} /></span>
                  <input type="email" autoComplete="email" required placeholder={t("login.emailPh")} value={email} onChange={(event) => setEmail(event.target.value)} />
                </div>
              </div>
              <div className="field">
                <div className="field-input">
                  <input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required placeholder="000000" aria-label={t("code.label")} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
                </div>
              </div>
              {message && <p className={sent ? "form-ok" : "form-error"} role="alert">{message}</p>}
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t("code.verifying") : t("code.submit")} <span className="arrow" aria-hidden>→</span></button>
            </form>
            <p className="auth-switch">
              {!preview && <button type="button" className="resend-link" onClick={resend} disabled={resending}>{resending ? t("forgot.sending") : sent ? t("code.resendAgain") : t("code.resend")}</button>}
            </p>
            <p className="auth-switch"><a href={preview ? previewHref("/login") : "/login"}>{t("forgot.backLogin")}</a></p>
          </section>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
