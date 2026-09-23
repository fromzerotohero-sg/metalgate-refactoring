"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, type AuthSession, type CreditsPayload, type SessionUser, type Upgrade } from "@/src/lib/api";
import { isLocalPreview, previewCredits, previewHref, previewSessions, previewUser } from "@/src/lib/preview";
import { useT, useLocale } from "@/src/lib/i18n";
import { SiteHeader } from "@/src/components/SiteHeader";
import { SiteFooter } from "@/src/components/SiteFooter";
import { PlatformCards } from "@/src/components/Grids";
import { Icon } from "@/src/components/Icon";

type AccountData = { session: SessionUser; credits: CreditsPayload; sessions: AuthSession[] };
type LoadState = "loading" | "ready" | "error";

function initials(user: SessionUser | undefined) {
  return (user?.username || user?.email || "U").slice(0, 2).toUpperCase();
}

export default function AccountPage() {
  const t = useT();
  const { locale } = useLocale();
  const preview = isLocalPreview();
  const [state, setState] = useState<LoadState>(preview ? "ready" : "loading");
  const [data, setData] = useState<AccountData | null>(preview ? { session: previewUser, credits: previewCredits, sessions: previewSessions } : null);
  const [subscriptionFlag, setSubscriptionFlag] = useState<string | null>(null);

  useEffect(() => {
    setSubscriptionFlag(new URLSearchParams(window.location.search).get("subscription"));
  }, []);

  const load = useCallback(async () => {
    if (preview) {
      setData({ session: previewUser, credits: previewCredits, sessions: previewSessions });
      setState("ready");
      return;
    }
    setState("loading");
    try {
      const [session, credits, sessionsResponse] = await Promise.all([api.session(), api.credits(), api.authSessions()]);
      setData({ session, credits, sessions: sessionsResponse?.sessions ?? [] });
      setState("ready");
    } catch (caught) {
      const error = caught as ApiError;
      if (error.status === 401) { window.location.href = "/login?return_to=/account"; return; }
      setState("error");
    }
  }, [preview]);

  useEffect(() => { void load(); }, [load]);

  const displayName = data?.session?.username || data?.session?.email?.split("@")[0] || "";
  const plan = data?.credits?.plan ?? null;
  const usage = data?.credits?.usage;
  const upgrade = data?.credits?.upgrade;
  const percent = typeof usage?.percent === "number" ? Math.min(100, Math.max(0, usage.percent)) : 0;
  // A free user has no plan allowance, so the API measures the bar against their
  // bonus credits instead — and the fill is amber for the same reason: it is all bonus.
  const hasBonusCredits = (usage?.credits_allowance ?? 0) > 0;
  const href = (path: string) => (preview ? previewHref(path) : path);
  const dateFmt = (value?: string) => value ? new Date(value).toLocaleDateString(locale === "en" ? "en-GB" : locale === "es" ? "es-ES" : "it-IT") : "—";

  /**
   * The wording on the upgrade call to action.
   *
   * The API decides *when* to offer an upgrade and *which* plan it points at, and it
   * also sends a ready-made `cta_label`. The words still belong here: every other
   * string on this page is translated and the API has no notion of a locale, so
   * rendering its label verbatim dropped an English sentence into an Italian page.
   *
   * The server uses the *same* sentence for both `reason` values — only the plan name
   * differs — so interpolating `next_plan.name` into the translation reproduces the
   * product's wording exactly, in the user's language, rather than inventing new copy.
   * `cta_label` remains the fallback so an offer this build cannot describe still
   * renders a button.
   */
  const upgradeLabel = (offer?: Upgrade | null) => {
    if (offer?.next_plan?.name) return t("account.upgradeLimits").replace("{plan}", offer.next_plan.name);
    return offer?.cta_label ?? t("account.choosePlan");
  };

  const lastSeen = useMemo(() => {
    const dates = (data?.sessions ?? []).map((session) => session.last_seen_at ?? session.created_at).filter(Boolean) as string[];
    return dates.sort().at(-1);
  }, [data]);

  const profileIncomplete = !preview && data ? (!data.session.username || !data.session.tag) : false;

  if (state === "loading") {
    return (
      <main className="auth-page">
        <SiteHeader />
        <div className="auth-loading"><img src="/logo.webp" alt="From Zero To Hero" /><div className="spinner" /></div>
      </main>
    );
  }

  if (state === "error" || !data) {
    return (
      <main className="auth-page">
        <SiteHeader />
        <div className="full-screen-center">
          <div className="error-panel">
            <h1>{t("account.errorTitle")}</h1>
            <p>{t("account.errorBody")}</p>
            <button className="btn btn-primary" onClick={() => void load()}>{t("common.retry")}</button>
            <a href="/">{t("common.backHome")}</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="light-page">
      <SiteHeader />
      <section className="hero-dark workspace-hero">
        <div className="workspace-hero-inner">
          <div>
            <p className="eyebrow">{preview ? t("account.demo") : t("account.yourPlatforms")}</p>
            <h1>{t("account.greeting").split("{name}")[0]}<em>{displayName}</em>{t("account.greeting").split("{name}")[1]}</h1>
            <p>{t("account.greetingSub")}</p>
          </div>
          <a className="btn btn-primary" href={href("/platforms")}>{t("account.explore")} <span className="arrow" aria-hidden>→</span></a>
        </div>
      </section>
      <div className="workspace-body">
        <div className="workspace-inner">
          <nav className="workspace-nav" aria-label="Account">
            <a className="selected" href={href("/account")}>{t("menu.overview")}</a>
            <a href={href("/account/profile")}>{t("menu.profile")}</a>
            <a href={href("/account/subscription")}>{t("menu.subscription")}</a>
            <a href={href("/account/security")}>{t("menu.security")}</a>
            <a href={href("/account/transactions")}>{t("menu.activity")}</a>
            <button onClick={async () => { if (!preview) await api.logout().catch(() => {}); window.location.href = "/"; }}>{t("menu.logout")}</button>
          </nav>

          <div className="workspace-grid">
            {subscriptionFlag === "success" && <div className="banner-message ok"><Icon name="checkCircle" size={17} /> {t("account.subSuccess")}</div>}
            {subscriptionFlag === "cancel" && <div className="banner-message info"><Icon name="sparkles" size={17} /> {t("account.subCancel")}</div>}
            {profileIncomplete && (
              <div className="banner-message info">
                <div><strong>{t("account.completeTitle")}</strong> — {t("account.completeBody")}</div>
                <a className="btn btn-primary" href={href("/account/profile")}>{t("account.completeCta")}</a>
              </div>
            )}

            <div className="span-12">
              <PlatformCards />
            </div>

            <article className="card span-6">
              <p className="eyebrow dark">{t("account.planLabel")}</p>
              <div className="plan-summary-top">
                <span className="plan-name">{plan?.name ?? t("account.free")}</span>
                {plan && plan.active !== false && !plan.cancel_at_period_end && <span className="badge-active">{t("account.active")}</span>}
                {(plan?.active === false) && <span className="badge-ended">{t("account.ended")}</span>}
              </div>
              {plan ? (
                <>
                  <div className="progress-track"><div className={`progress-fill ${usage?.overfilled ? "bonus" : ""}`} style={{ width: `${usage?.overfilled ? 100 : percent}%` }} /></div>
                  <p className="progress-label">{Math.round(usage?.overfilled ? 100 : percent)}% {t("account.used")}</p>
                  {usage?.overfilled && <p className="card-note">{t("account.bonus")}</p>}
                  {plan.cancel_at_period_end && <p className="card-note">{t("account.untilEnd").replace("{date}", dateFmt(plan.current_period_end))}</p>}
                  {plan.active === false && <a className="btn btn-primary" style={{ marginTop: 16 }} href={href("/pricing")}>{t("account.resubscribe")}</a>}
                  {upgrade?.show && upgrade.url && (
                    <a className="upgrade-cta" href={preview ? href("/pricing") : upgrade.url}>{upgradeLabel(upgrade)} <span aria-hidden>→</span></a>
                  )}
                </>
              ) : (
                <>
                  {hasBonusCredits && (
                    <>
                      <div className="progress-track"><div className="progress-fill bonus" style={{ width: `${percent}%` }} /></div>
                      <p className="progress-label">{Math.round(percent)}% {t("account.used")}</p>
                      <p className="card-note">{t("account.bonusOnly")}</p>
                    </>
                  )}
                  <p className="card-note" style={{ marginTop: 4 }}><strong>{t("account.noPlan")}</strong> — {t("account.noPlanSub")}</p>
                  <div className="card-actions">
                    {/*
                     * With no plan the API still sends an `upgrade` block, with
                     * `reason: "no_plan"`, `next_plan` set to the entry plan and
                     * `url` pointing at the store. Using it here (instead of a
                     * hardcoded /pricing) means the store link is whatever the
                     * backend is configured with.
                     */}
                    <a className="btn btn-primary" href={preview ? href("/pricing") : upgrade?.url ?? href("/pricing")}>
                      {upgradeLabel(upgrade)}
                    </a>
                  </div>
                </>
              )}
              <div className="card-actions">
                <a className="btn btn-outline" href={href("/account/subscription")}>{t("account.managePlan")} <span className="arrow" aria-hidden>→</span></a>
              </div>
            </article>

            <article className="card span-6">
              <p className="eyebrow dark">{t("account.lastAccess")}</p>
              <div className="last-access">
                <span className="last-access-icon" aria-hidden><Icon name="clock" size={21} /></span>
                <div>
                  <strong>{lastSeen ? new Date(lastSeen).toLocaleString(locale === "en" ? "en-GB" : locale === "es" ? "es-ES" : "it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</strong>
                  <small>{t("account.keepBuilding")}</small>
                </div>
                <span className="avatar" style={{ marginLeft: "auto" }}>{initials(data.session)}</span>
              </div>
            </article>
          </div>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
