"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, ApiError, googleSignInUrl } from "@/src/lib/api";
import { isLocalPreview, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { GoogleMark, Icon } from "@/src/components/Icon";

function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export default function LoginPage() {
  const t = useT();
  const preview = isLocalPreview();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(!preview);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const returnTo = useMemo(() => typeof window === "undefined" ? "/account" : safeReturnTo(new URLSearchParams(window.location.search).get("return_to") ?? new URLSearchParams(window.location.search).get("redirect")), []);
  // The API reports the outcome of a Google handshake as ?oauth=<code> when it
  // sends the browser back (see routes_google.py).
  const oauthOutcome = useMemo(() => typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("oauth") ?? ""), []);

  useEffect(() => {
    if (preview) { setChecking(false); return; }
    if (oauthOutcome && oauthOutcome !== "success") {
      setMessage(
        oauthOutcome === "cancelled" ? t("login.googleCancelled")
        : oauthOutcome === "unavailable" ? t("login.googleUnavailable")
        : t("login.googleFailed")
      );
    }
    api.session().then(() => { window.location.href = returnTo; }).catch(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, returnTo, oauthOutcome]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (preview) { window.location.href = previewHref("/account"); return; }
    setBusy(true);
    setMessage("");
    setVerificationRequired(false);
    try {
      await api.login({ email: email.trim(), password });
      window.location.href = returnTo;
    } catch (error) {
      const caught = error as ApiError;
      if (caught.payload?.requires_verification) {
        setVerificationRequired(true);
        setMessage(t("login.needsVerification"));
      } else {
        setMessage(t("login.invalid"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setMessage("");
    try {
      await api.sendVerification({ email: email.trim(), redirect: `${window.location.origin}/verify-email` });
      setMessage(t("login.resent"));
      setVerificationRequired(false);
    } catch (error) {
      setMessage((error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  const href = (path: string) => (preview ? previewHref(path) : path);

  if (checking) {
    return (
      <main className="auth-page">
        <div className="auth-loading"><img src="/logo.webp" alt="From Zero To Hero" /><span>{t("login.checking")}</span></div>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <SiteHeader />
      <div className="auth-hero">
        <div className="auth-layout">
          <section className="auth-copy">
            <p className="eyebrow">{t("home.eyebrow")}</p>
            <h1 className="hero-title">{t("login.heroTitle1")}<br /><em>{t("login.heroTitle2")}</em></h1>
            <p className="hero-lead">{t("login.heroLead")}</p>
            <div className="hero-pills">
              <span className="hero-pill"><span className="hero-pill-icon"><Icon name="zap" size={17} /></span>{t("login.pill1")}</span>
              <span className="hero-pill"><span className="hero-pill-icon"><Icon name="grid" size={17} /></span>{t("login.pill2")}</span>
              <span className="hero-pill"><span className="hero-pill-icon"><Icon name="infinity" size={17} /></span>{t("login.pill3")}</span>
            </div>
          </section>
          <section className="auth-card">
            <h1>{t("login.cardTitle")}</h1>
            <p className="auth-card-lead">{t("login.cardLead")}</p>
            <form onSubmit={submit}>
              <div className="field">
                <div className="field-input">
                  <span className="field-icon" aria-hidden><Icon name="mail" size={16} /></span>
                  <input type="email" autoComplete="email" required placeholder={t("login.emailPh")} value={email} onChange={(event) => setEmail(event.target.value)} />
                </div>
              </div>
              <div className="field">
                <div className="field-input">
                  <span className="field-icon" aria-hidden><Icon name="lock" size={16} /></span>
                  <input type={showPassword ? "text" : "password"} autoComplete="current-password" required placeholder={t("login.passwordPh")} value={password} onChange={(event) => setPassword(event.target.value)} />
                  <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? t("login.hide") : t("login.show")}</button>
                </div>
              </div>
              <div className="form-row-between">
                {/*
                 * There is deliberately no "stay signed in" checkbox. Every
                 * SilverGate session lasts until the user logs out, on every
                 * platform at once — a checkbox here would imply a choice the
                 * backend does not offer, and unchecking it would do nothing.
                 */}
                <small className="field-hint">{t("login.sessionNote")}</small>
                <a href={`/forgot-password?email=${encodeURIComponent(email)}${preview ? "&preview=1" : ""}`}>{t("login.forgot")}</a>
              </div>
              {message && <p className={verificationRequired || message === t("login.resent") ? "form-ok" : "form-error"} role="alert">{message}</p>}
              {verificationRequired && <button type="button" className="resend-link" onClick={resendVerification} disabled={busy}>{t("login.resend")}</button>}
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t("login.submitting") : t("login.submit")} <span className="arrow" aria-hidden>→</span></button>
            </form>
            <div className="auth-divider">{t("login.divider")}</div>
            <a className="btn btn-outline btn-block btn-google" href={preview ? href(returnTo) : googleSignInUrl(returnTo)}>
              <GoogleMark size={18} />
              <span>{t("login.googleCta")}</span>
            </a>
            <a className="btn btn-outline btn-block" href={`/register?return_to=${encodeURIComponent(returnTo)}${preview ? "&preview=1" : ""}`} style={{ marginTop: 10 }}>{t("login.create")}</a>
            <div className="auth-note">
              <span className="auth-note-icon" aria-hidden><Icon name="infinity" size={18} /></span>
              <div><strong>{t("login.noteTitle")}</strong><small>{t("login.noteSub")}</small></div>
            </div>
          </section>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
