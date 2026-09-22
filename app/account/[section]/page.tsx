"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError, type AuthSession, type CreditsPayload, type SessionUser, type Transaction } from "@/src/lib/api";
import { isLocalPreview, previewCredits, previewHref, previewSessions, previewTransactions, previewUser } from "@/src/lib/preview";
import { useT } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { Icon } from "@/src/components/Icon";

type SectionKey = "profile" | "subscription" | "security" | "transactions";

export default function AccountSectionPage() {
  const params = useParams<{ section: string }>();
  const section = (["profile", "subscription", "security", "transactions"].includes(params.section) ? params.section : "profile") as SectionKey;
  const t = useT();
  const preview = isLocalPreview();

  const [user, setUser] = useState<SessionUser | null>(preview ? previewUser : null);
  const [credits, setCredits] = useState<CreditsPayload | null>(preview ? previewCredits : null);
  const [sessions, setSessions] = useState<AuthSession[]>(preview ? previewSessions : []);
  const [transactions, setTransactions] = useState<Transaction[]>(preview ? previewTransactions : []);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(preview ? previewUser.username ?? "" : "");
  const [tag, setTag] = useState(preview ? previewUser.tag ?? "" : "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showUsage, setShowUsage] = useState(false);

  const load = useCallback(async () => {
    setMessage("");
    setOk(false);
    if (preview) {
      setUser(previewUser); setCredits(previewCredits); setSessions(previewSessions); setTransactions(previewTransactions);
      setUsername(previewUser.username ?? ""); setTag(previewUser.tag ?? "");
      return;
    }
    setBusy(true);
    try {
      if (section === "profile") {
        const result = await api.me() as SessionUser;
        setUser(result);
        setUsername(result.username ?? "");
        setTag(result.tag ?? "");
      } else if (section === "subscription") {
        setCredits(await api.credits());
      } else if (section === "security") {
        setSessions((await api.authSessions()).sessions ?? []);
      } else {
        setTransactions((await api.transactions()).transactions ?? []);
      }
    } catch (caught) {
      const error = caught as ApiError;
      if (error.status === 401) { window.location.href = `/login?return_to=/account/${section}`; return; }
      setMessage(error.message || t("common.error"));
    } finally {
      setBusy(false);
    }
  }, [preview, section, t]);

  useEffect(() => { void load(); }, [load]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    if (preview) { setOk(true); setMessage(t("section.profile.saved")); return; }
    setBusy(true);
    setMessage("");
    try {
      await api.profile({ username, tag });
      setOk(true);
      setMessage(t("section.profile.saved"));
    } catch (error) {
      setOk(false);
      setMessage((error as ApiError).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 8) { setOk(false); setMessage(t("register.passwordShort")); return; }
    if (preview) { setOk(true); setMessage(t("section.security.updated")); setCurrentPassword(""); setNewPassword(""); return; }
    setBusy(true);
    setMessage("");
    try {
      await api.changePassword({ current_password: currentPassword, new_password: newPassword });
      setOk(true);
      setMessage(t("section.security.updated"));
      setCurrentPassword("");
      setNewPassword("");
      await load();
    } catch (error) {
      setOk(false);
      setMessage((error as ApiError).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  function openPortal() {
    if (preview) { setOk(false); setMessage(t("section.subscription.portalDisabled")); return; }
    api.portal(window.location.origin + "/account/subscription")
      .then((result) => { window.location.href = result.url; })
      .catch((error: ApiError) => setMessage(error.message || t("common.error")));
  }

  async function cancelSubscription() {
    if (!plan?.current_period_end) return;
    const endsOn = dateFmt(plan.current_period_end);
    if (!window.confirm(t("section.subscription.cancelConfirm").replace("{date}", endsOn))) return;
    if (preview) { setOk(true); setMessage(t("section.subscription.cancelled").replace("{date}", endsOn)); return; }
    setBusy(true);
    setMessage("");
    try {
      await api.cancelSubscription();
      await load();
      setOk(true);
      setMessage(t("section.subscription.cancelled").replace("{date}", endsOn));
    } catch (error) {
      setOk(false);
      setMessage((error as ApiError).message || t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  const href = (path: string) => (preview ? previewHref(path) : path);
  const dateFmt = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : "—");
  const usage = credits?.usage;
  const plan = credits?.plan;
  const percent = typeof usage?.percent === "number" ? Math.min(100, Math.max(0, usage.percent)) : 0;

  const payments = transactions.filter((transaction) => transaction.amount > 0);
  const usageList = transactions.filter((transaction) => transaction.amount <= 0);
  const now = new Date();
  const monthTransactions = transactions.filter((transaction) => {
    const date = new Date(transaction.timestamp ?? "");
    return !Number.isNaN(date.getTime()) && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
  const monthUsed = monthTransactions.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const monthAdded = monthTransactions.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
  const monthCount = monthTransactions.length;

  function renderTransaction(transaction: Transaction) {
    return (
      <div className="transaction-row" key={transaction.id}>
        <div>
          <strong>{transaction.description}</strong>
          <small>{transaction.timestamp ? new Date(transaction.timestamp).toLocaleString() : ""}</small>
        </div>
        <span className={`transaction-amount ${transaction.amount > 0 ? "positive" : ""}`}>{transaction.amount > 0 ? "+" : ""}{transaction.amount}</span>
      </div>
    );
  }

  return (
    <main className="light-page">
      <SiteHeader />
      <section className="page-hero">
        <p className="eyebrow">{t(`section.${section}.eyebrow`)}</p>
        <h1>{t(`section.${section}.title`)}</h1>
        <p>{t(`section.${section}.intro`)}</p>
      </section>
      <div className="page-body" style={{ maxWidth: 980 }}>
        <a className="back-link" href={href("/account")}>← {t("section.back")}</a>
        {message && <div className={ok ? "form-ok" : "form-error"} role="status" style={{ marginBottom: 20 }}>{message}</div>}

        {section === "profile" && (
          <div className="section-layout">
            <article className="card">
              <h2>{t("section.profile.public")}</h2>
              <p className="card-note">{t("section.profile.publicDesc")}</p>
              <form className="account-form" onSubmit={saveProfile}>
                <div className="field">
                  <span className="field-label">{t("section.profile.username")}</span>
                  <div className="field-input"><input value={username} onChange={(event) => setUsername(event.target.value)} /></div>
                </div>
                <div className="field">
                  <span className="field-label">{t("section.profile.tag")}</span>
                  <div className="field-input"><input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="1234" /></div>
                </div>
                <button className="btn btn-primary" disabled={busy}>{busy ? t("section.profile.saving") : t("section.profile.save")}</button>
              </form>
            </article>
            <article className="card">
              <p className="eyebrow dark">{t("section.profile.account")}</p>
              <h2 style={{ wordBreak: "break-all" }}>{user?.email ?? ""}</h2>
              <p className="card-note">{t("section.profile.emailNote")}</p>
              {!preview && (
                <button className="danger-link" onClick={async () => {
                  if (!window.confirm(t("section.profile.deleteConfirm"))) return;
                  await api.deleteAccount().catch(() => {});
                  window.location.href = "/";
                }}>{t("section.profile.delete")}</button>
              )}
            </article>
          </div>
        )}

        {section === "subscription" && (
          <div className="section-layout">
            <article className="card">
              <p className="eyebrow dark">{t("section.subscription.current")}</p>
              <div className="plan-summary-top">
                <span className="plan-name">{plan?.name ?? t("account.free")}</span>
                {plan && plan.active !== false && !plan.cancel_at_period_end && <span className="badge-active">{t("account.active")}</span>}
                {plan?.active === false && <span className="badge-ended">{t("section.subscription.ended")}</span>}
              </div>
              {plan && (
                <>
                  <div className="progress-track"><div className={`progress-fill ${usage?.overfilled ? "bonus" : ""}`} style={{ width: `${usage?.overfilled ? 100 : percent}%` }} /></div>
                  <p className="progress-label">{Math.round(usage?.overfilled ? 100 : percent)}% {t("account.used")}</p>
                  {usage?.overfilled && <div className="inline-message">{t("section.subscription.bonus")}</div>}
                  {plan.cancel_at_period_end && <div className="inline-message">{t("section.subscription.untilEnd")}</div>}
                  {plan.active === false && <div className="inline-message">{t("section.subscription.ended")}</div>}
                </>
              )}
              <div className="card-actions">
                <a className="btn btn-primary" href={href("/pricing")}>{t("section.subscription.viewPlans")}</a>
              </div>
            </article>
            <article className="card">
              <p className="eyebrow dark">{t("section.subscription.manage")}</p>
              {plan && plan.active !== false ? (
                <>
                  <h2>{plan.cancel_at_period_end ? t("section.subscription.endsTitle") : t("section.subscription.renewsTitle")}</h2>
                  <p className="card-note">
                    {(plan.cancel_at_period_end ? t("section.subscription.endsBody") : t("section.subscription.renewsBody")).replace("{date}", dateFmt(plan.current_period_end))}
                  </p>
                  <div className="card-actions">
                    {!plan.cancel_at_period_end && (
                      <button className="btn btn-outline" onClick={cancelSubscription} disabled={busy}>
                        {busy ? t("section.subscription.cancelling") : t("section.subscription.cancel")}
                      </button>
                    )}
                    <button className="btn btn-outline" onClick={openPortal}>{t("section.subscription.openPortal")} →</button>
                  </div>
                </>
              ) : (
                <>
                  <h2>{t("section.subscription.manageTitle")}</h2>
                  <p className="card-note">{t("section.subscription.manageDesc")}</p>
                  <div className="card-actions">
                    <button className="btn btn-outline" onClick={openPortal}>{t("section.subscription.openPortal")} →</button>
                  </div>
                </>
              )}
            </article>
          </div>
        )}

        {section === "security" && (
          <div className="section-layout">
            <article className="card">
              <h2>{t("section.security.change")}</h2>
              <form className="account-form" onSubmit={changePassword}>
                <div className="field">
                  <span className="field-label">{t("section.security.current")}</span>
                  <div className="field-input"><input type="password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
                </div>
                <div className="field">
                  <span className="field-label">{t("section.security.new")}</span>
                  <div className="field-input"><input type="password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></div>
                  <small className="field-hint">{t("register.passwordHint")}</small>
                </div>
                <button className="btn btn-primary" disabled={busy}>{t("section.security.update")}</button>
              </form>
            </article>
            <article className="card">
              <h2>{t("section.security.devices")}</h2>
              {sessions.map((session) => (
                <div className="device-row" key={session.id}>
                  <span className={`device-dot ${session.current ? "" : "off"}`}>●</span>
                  <div>
                    <strong>{session.current ? t("section.security.thisDevice") : session.service ?? t("section.security.otherDevice")}</strong>
                    <small>{session.user_agent ?? t("section.security.activeSession")}</small>
                  </div>
                  {!session.current && !preview && (
                    <button className="text-button" onClick={() => api.revokeSession(session.id).then(load).catch((error: ApiError) => setMessage(error.message))}>{t("section.security.disconnect")}</button>
                  )}
                </div>
              ))}
              {!preview && (
                <button className="danger-link" onClick={async () => { await api.logoutAll().catch(() => {}); window.location.href = "/login"; }}>{t("section.security.disconnectOthers")}</button>
              )}
            </article>
          </div>
        )}

        {section === "transactions" && (
          <>
            <div className="tx-summary">
              <p className="eyebrow dark">{t("section.transactions.summary")}</p>
              <div className="tx-stats">
                <div className="tx-stat"><strong>-{monthUsed}</strong><small>{t("section.transactions.usedMonth")}</small></div>
                <div className="tx-stat"><strong>+{monthAdded}</strong><small>{t("section.transactions.addedMonth")}</small></div>
                <div className="tx-stat"><strong>{monthCount}</strong><small>{t("section.transactions.opsMonth")}</small></div>
              </div>
            </div>
            <article className="card">
              <p className="eyebrow dark">{t("section.transactions.payments")}</p>
              {payments.length ? payments.map(renderTransaction) : (
                <div className="empty-state"><span><Icon name="sparkles" size={26} /></span><p>{t("section.transactions.noPayments")}</p></div>
              )}
            </article>
            <article className="card" style={{ marginTop: 24 }}>
              <button type="button" className="tx-toggle" onClick={() => setShowUsage((value) => !value)} aria-expanded={showUsage}>
                <span>{t("section.transactions.usage").replace("{count}", String(usageList.length))}</span>
                <span className={`tx-chevron ${showUsage ? "open" : ""}`} aria-hidden><Icon name="arrowRight" size={16} /></span>
              </button>
              {showUsage && (
                usageList.length ? usageList.map(renderTransaction) : (
                  <div className="empty-state"><span><Icon name="sparkles" size={26} /></span><p>{t("section.transactions.noUsage")}</p></div>
                )
              )}
            </article>
          </>
        )}
      </div>
      <SiteFooter />
    </main>
  );
}
