"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/src/lib/api";
import { isLocalPreview, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { Icon } from "@/src/components/Icon";

function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export default function RegisterPage() {
  const t = useT();
  const preview = isLocalPreview();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const returnTo = useMemo(() => typeof window === "undefined" ? "/account" : safeReturnTo(new URLSearchParams(window.location.search).get("return_to") ?? new URLSearchParams(window.location.search).get("redirect")), []);
  const href = (path: string) => (preview ? previewHref(path) : path);

  useEffect(() => {
    if (preview) return;
    api.session().then(() => { window.location.href = returnTo; }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setMessage(t("register.passwordShort")); return; }
    if (!accepted) { setMessage(t("register.acceptRequired")); return; }
    if (preview) { setDone(true); setMessage(t("register.doneBody")); return; }
    setBusy(true);
    setMessage("");
    setDeliveryFailed(false);
    try {
      const response = await api.register({
        email: email.trim(), password,
        username: username.trim() || undefined,
        referral_code: referralCode.trim() || undefined,
        redirect: `${window.location.origin}/verify-email`
      });
      setDeliveryFailed(response.verification_email_sent === false);
      setDone(true);
      setMessage(response.verification_email_sent === false ? t("register.doneFailed") : t("register.doneBody"));
    } catch (error) {
      setMessage((error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    try {
      await api.sendVerification({ email: email.trim(), redirect: `${window.location.origin}/verify-email` });
      setDeliveryFailed(false);
      setMessage(t("register.resent"));
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
        <div className="auth-layout">
          <section className="auth-copy">
            <p className="eyebrow">{t("home.eyebrow")}</p>
            <h1 className="hero-title">{t("register.heroTitle1")}<br /><em>{t("register.heroTitle2")}</em></h1>
            <p className="hero-lead">{t("register.heroLead")}</p>
            <div className="auth-feats">
              <div className="auth-feat"><span className="auth-feat-icon" aria-hidden><Icon name="book" size={21} /></span><div><strong>{t("register.feat1t")}</strong><small>{t("register.feat1d")}</small></div></div>
              <div className="auth-feat"><span className="auth-feat-icon" aria-hidden><Icon name="chart" size={21} /></span><div><strong>{t("register.feat2t")}</strong><small>{t("register.feat2d")}</small></div></div>
              <div className="auth-feat"><span className="auth-feat-icon" aria-hidden><Icon name="users" size={21} /></span><div><strong>{t("register.feat3t")}</strong><small>{t("register.feat3d")}</small></div></div>
            </div>
          </section>
          <section className="auth-card">
            {done ? (
              <>
                <div className="success-mark" aria-hidden><Icon name="check" size={26} /></div>
                <p className="eyebrow dark">{t("register.doneEyebrow")}</p>
                <h2>{t("register.doneTitle")}</h2>
                <p className="auth-card-lead">{message}</p>
                <div className="mail-note"><strong>{email}</strong><span>{t("register.doneValidity")}</span></div>
                {deliveryFailed && !preview && (
                  <button type="button" className="btn btn-outline btn-block" onClick={resendVerification} disabled={busy}>
                    {busy ? t("register.resending") : t("register.resend")}
                  </button>
                )}
                <a className="btn btn-primary btn-block" style={{ marginTop: 14 }} href={href(`/login?return_to=${encodeURIComponent(returnTo)}`)}>{t("register.backLogin")} <span className="arrow" aria-hidden>→</span></a>
              </>
            ) : (
              <>
                <h1>{t("register.cardTitle")}</h1>
                <p className="auth-card-lead">{t("register.cardLead")}</p>
                <form onSubmit={submit}>
                  <div className="field">
                    <div className="field-input">
                      <span className="field-icon" aria-hidden><Icon name="mail" size={16} /></span>
                      <input type="email" autoComplete="email" required placeholder={t("login.emailPh")} value={email} onChange={(event) => setEmail(event.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <div className="field-input">
                      <span className="field-icon" aria-hidden><Icon name="user" size={16} /></span>
                      <input autoComplete="nickname" placeholder={t("register.usernamePh")} value={username} onChange={(event) => setUsername(event.target.value)} />
                    </div>
                    <small className="field-hint">{t("register.usernameHint")}</small>
                  </div>
                  <div className="field">
                    <div className="field-input">
                      <span className="field-icon" aria-hidden><Icon name="lock" size={16} /></span>
                      <input type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={8} required placeholder={t("register.passwordPh")} value={password} onChange={(event) => setPassword(event.target.value)} />
                      <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? t("login.hide") : t("login.show")}</button>
                    </div>
                    <small className="field-hint">{t("register.passwordHint")}</small>
                  </div>
                  <div className="field">
                    <div className="field-input">
                      <span className="field-icon" aria-hidden><Icon name="gift" size={16} /></span>
                      <input placeholder={t("register.invitePh")} value={referralCode} onChange={(event) => setReferralCode(event.target.value)} />
                    </div>
                    <small className="field-hint">{t("register.inviteHint")}</small>
                  </div>
                  <label className="checkbox-row">
                    <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
                    <span>{t("register.acceptPrefix")}<a href={href("/legal/terms")} target="_blank" rel="noopener noreferrer">{t("register.terms")}</a>{t("register.acceptAnd")}<a href={href("/legal/privacy")} target="_blank" rel="noopener noreferrer">{t("register.privacy")}</a>.</span>
                  </label>
                  {message && <p className="form-error" role="alert">{message}</p>}
                  <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t("register.submitting") : t("register.submit")} <span className="arrow" aria-hidden>→</span></button>
                </form>
                <p className="auth-switch">{t("register.haveAccount")} <a href={href(`/login?return_to=${encodeURIComponent(returnTo)}`)}>{t("register.login")}</a></p>
              </>
            )}
          </section>
          <div className="auth-below">
            <div className="mini-steps">
              <p className="mini-steps-title">{t("register.stepsTitle")}</p>
              {[1, 2, 3].map((step) => (
                <div className="mini-step" key={step}>
                  <span className="mini-step-icon" aria-hidden><Icon name={step === 1 ? "user" : step === 2 ? "mail" : "checkCircle"} size={19} /></span>
                  <strong>{step}. {t(`register.step${step}t`)}</strong>
                  <small>{t(`register.step${step}d`)}</small>
                </div>
              ))}
            </div>
            <div className="auth-safe" style={{ marginTop: 18 }}>
              <span className="auth-note-icon" aria-hidden><Icon name="shieldCheck" size={18} /></span>
              <span>{t("register.emailSafe")}</span>
            </div>
          </div>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
