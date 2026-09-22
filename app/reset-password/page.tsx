"use client";

import { FormEvent, useMemo, useState } from "react";
import { api, ApiError } from "@/src/lib/api";
import { isLocalPreview, previewHref } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { Icon } from "@/src/components/Icon";

export default function ResetPasswordPage() {
  const t = useT();
  const preview = isLocalPreview();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const token = useMemo(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("token") ?? "", []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!token) { setMessage(t("reset.invalidLink")); return; }
    if (password.length < 8) { setMessage(t("register.passwordShort")); return; }
    if (password !== confirmation) { setMessage(t("reset.mismatch")); return; }
    if (preview) { setDone(true); return; }
    setBusy(true);
    setMessage("");
    try {
      await api.resetPassword({ token, password });
      setDone(true);
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
            {done ? (
              <>
                <div className="success-mark" aria-hidden><Icon name="check" size={26} /></div>
                <p className="eyebrow dark">{t("reset.doneEyebrow")}</p>
                <h1>{t("reset.doneTitle")}</h1>
                <p className="auth-card-lead">{t("reset.doneBody")}</p>
                <a className="btn btn-primary btn-block" href={preview ? previewHref("/login") : "/login"}>{t("reset.goLogin")} <span className="arrow" aria-hidden>→</span></a>
              </>
            ) : (
              <>
                <p className="eyebrow dark">{t("reset.eyebrow")}</p>
                <h1>{t("reset.title")}</h1>
                <p className="auth-card-lead">{t("reset.lead")}</p>
                <form onSubmit={submit}>
                  <div className="field">
                    <div className="field-input">
                      <span className="field-icon" aria-hidden><Icon name="lock" size={16} /></span>
                      <input type="password" autoComplete="new-password" minLength={8} required placeholder={t("reset.newPassword")} value={password} onChange={(event) => setPassword(event.target.value)} />
                    </div>
                  </div>
                  <div className="field">
                    <div className="field-input">
                      <span className="field-icon" aria-hidden><Icon name="lock" size={16} /></span>
                      <input type="password" autoComplete="new-password" minLength={8} required placeholder={t("reset.repeat")} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
                    </div>
                  </div>
                  {message && <p className="form-error" role="alert">{message}</p>}
                  <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t("reset.saving") : t("reset.submit")} <span className="arrow" aria-hidden>→</span></button>
                </form>
                <p className="auth-switch"><a href={preview ? previewHref("/login") : "/login"}>{t("forgot.backLogin")}</a></p>
              </>
            )}
          </section>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
