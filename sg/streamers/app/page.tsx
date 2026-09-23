"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  clearToken,
  saveToken,
  storedToken,
  streamerApi,
  type NetworkResponse,
  type NetworkUser,
  type StreamerDashboard,
} from "@/src/lib/api";
import { COPY, LOCALE_LABELS, LOCALES, type Locale } from "@/src/lib/i18n";

type ViewState = "checking" | "login" | "loading" | "ready" | "error";
type SortKey = "username" | "euros_spent" | "credits_bought" | "credits_spent" | "joined_at";
type Sort = { key: SortKey; direction: "asc" | "desc" };

const BROWSER_LOCALE: Record<Locale, string> = { it: "it-IT", en: "en-US", es: "es-ES" };
const LANGUAGE_STORAGE_KEY = "silvergate_streamer_locale";

function initials(code?: string | null) {
  return (code || "ST").slice(0, 2).toUpperCase();
}

function ordered(users: NetworkUser[], sort: Sort, locale: Locale) {
  return [...users].sort((a, b) => {
    const left = sort.key === "joined_at" ? new Date(a.joined_at ?? 0).getTime() : a[sort.key];
    const right = sort.key === "joined_at" ? new Date(b.joined_at ?? 0).getTime() : b[sort.key];
    const result = typeof left === "string" && typeof right === "string"
      ? left.localeCompare(right, BROWSER_LOCALE[locale])
      : Number(left ?? 0) - Number(right ?? 0);
    return sort.direction === "asc" ? result : -result;
  });
}

export default function StreamerPortal() {
  const [locale, setLocale] = useState<Locale>("it");
  const [state, setState] = useState<ViewState>("checking");
  const [token, setToken] = useState<string | null>(null);
  const [dashboard, setDashboard] = useState<StreamerDashboard | null>(null);
  const [network, setNetwork] = useState<NetworkResponse | null>(null);
  const [loginError, setLoginError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [idCode, setIdCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [userPage, setUserPage] = useState(1);
  const [teamPage, setTeamPage] = useState(1);
  const [selectedStreamerId, setSelectedStreamerId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: "joined_at", direction: "desc" });
  const [copyState, setCopyState] = useState("");
  const t = COPY[locale];
  const copyRef = useRef(t);
  copyRef.current = t;
  const formatLocale = BROWSER_LOCALE[locale];
  const currency = useMemo(() => new Intl.NumberFormat(formatLocale, { style: "currency", currency: "EUR" }), [formatLocale]);
  const integer = useMemo(() => new Intl.NumberFormat(formatLocale), [formatLocale]);
  const formatDate = useCallback((value?: string | null) => value ? new Intl.DateTimeFormat(formatLocale, { dateStyle: "medium" }).format(new Date(value)) : "—", [formatLocale]);

  useEffect(() => {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) setLocale(saved as Locale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLocale);
  }

  const load = useCallback(async (activeToken: string, page = 1, managerPage = 1) => {
    setState("loading");
    setLoadError("");
    try {
      const dashboardData = await streamerApi.dashboard(activeToken, managerPage);
      const users = await streamerApi.subscribed(activeToken, dashboardData.profile.id, page);
      setDashboard(dashboardData);
      setNetwork(users);
      setUserPage(page);
      setTeamPage(managerPage);
      setState("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearToken();
        setToken(null);
        setState("login");
        setLoginError(copyRef.current.sessionExpired);
        return;
      }
      setLoadError(error instanceof Error ? error.message : copyRef.current.dashboardLoadFailed);
      setState("error");
    }
  }, []);

  useEffect(() => {
    const saved = storedToken();
    if (!saved) {
      setState("login");
      return;
    }
    setToken(saved);
    void load(saved);
  }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setLoginError("");
    try {
      const response = await streamerApi.login(idCode.trim().toUpperCase(), password);
      saveToken(response.token);
      setToken(response.token);
      setPassword("");
      await load(response.token);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : t.loginFailed);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    clearToken();
    setToken(null);
    setDashboard(null);
    setNetwork(null);
    setSelectedStreamerId(null);
    setPassword("");
    setState("login");
  }

  function toggleSort(key: SortKey) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "username" ? "asc" : "desc" });
  }

  const profile = dashboard?.profile;
  const subordinates = dashboard?.subordinates ?? [];
  const selectedStreamer = subordinates.find((streamer) => streamer.id === selectedStreamerId);
  const visibleUsers = useMemo(() => {
    const users = network?.users ?? [];
    return ordered(selectedStreamerId ? users.filter((user) => user.streamer_id === selectedStreamerId) : users, sort, locale);
  }, [network?.users, selectedStreamerId, sort, locale]);
  const signupUrl = process.env.NEXT_PUBLIC_SIGNUP_URL ?? "/register";
  const referralLink = profile?.id_code ? `${signupUrl}${signupUrl.includes("?") ? "&" : "?"}ref=${encodeURIComponent(profile.id_code)}` : "";

  async function copyReferralLink() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopyState(t.copySuccess);
    } catch {
      setCopyState(t.copyFailure);
    }
    window.setTimeout(() => setCopyState(""), 2600);
  }

  const languageSwitcher = <LanguageSwitcher locale={locale} onChange={changeLocale} />;

  if (state === "checking" || state === "loading") {
    return <LoadingScreen label={state === "checking" ? t.loadingSession : t.loadingDashboard} languageSwitcher={languageSwitcher} />;
  }

  if (state === "login") {
    return (
      <main className="portal-shell auth-shell">
        <div className="portal-topbar"><PortalBrand />{languageSwitcher}</div>
        <section className="login-layout">
          <div className="login-copy">
            <p className="eyebrow">{t.partnerPortal}</p>
            <h1>{t.loginTitle.split(". ").map((part, index) => <span key={part}>{index > 0 && <br />}<em>{index === 1 ? part : undefined}</em>{index === 0 ? part : null}</span>)}</h1>
            <p>{t.loginLead}</p>
            <ul>
              <li>{t.loginBenefitEarnings}</li>
              <li>{t.loginBenefitReferrals}</li>
              <li>{t.loginBenefitTeam}</li>
            </ul>
          </div>
          <section className="login-card" aria-labelledby="login-title">
            <div className="login-avatar" aria-hidden>{initials(idCode)}</div>
            <h2 id="login-title">{t.loginCardTitle}</h2>
            <p>{t.loginCardLead}</p>
            <form onSubmit={submit}>
              <label className="field-label" htmlFor="streamer-code">{t.streamerCode}</label>
              <input id="streamer-code" className="field-input" autoComplete="username" placeholder={t.streamerCodePlaceholder} value={idCode} onChange={(event) => setIdCode(event.target.value.toUpperCase())} required />
              <label className="field-label" htmlFor="streamer-password">{t.password}</label>
              <div className="password-field">
                <input id="streamer-password" className="field-input" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} required />
                <button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? t.hide : t.show}</button>
              </div>
              {loginError && <p className="form-error" role="alert">{loginError}</p>}
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? t.loginSubmitting : t.login} <span aria-hidden>→</span></button>
            </form>
            <p className="login-security">{t.sessionNotice}</p>
          </section>
        </section>
      </main>
    );
  }

  if (state === "error" || !profile || !network) {
    return (
      <main className="portal-shell error-shell">
        <div className="portal-topbar"><PortalBrand />{languageSwitcher}</div>
        <section className="error-panel">
          <p className="eyebrow">{t.loadError}</p>
          <h1>{t.loadErrorTitle}</h1>
          <p>{loadError || t.dashboardLoadFailed}</p>
          <div className="error-actions">
            <button className="btn btn-primary" onClick={() => token && void load(token, userPage, teamPage)}>{t.retry}</button>
            <button className="btn btn-outline" onClick={logout}>{t.logout}</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="portal-shell dashboard-shell">
      <header className="portal-header">
        <PortalBrand compact />
        <div className="portal-header-actions">{languageSwitcher}<div className="portal-user">
          <span className="user-avatar">{initials(profile.id_code)}</span>
          <div><strong>{profile.id_code}</strong><small>{profile.is_manager ? t.manager : t.partnerStreamer}</small></div>
          <button className="logout" onClick={logout}>{t.logout}</button>
        </div></div>
      </header>

      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">{t.overview}</p>
          <h1>{t.greeting(profile.id_code)}</h1>
          <p>{t.overviewLead}</p>
        </div>
        <div className="code-chip"><span>{t.referralCode}</span><strong>{profile.id_code}</strong></div>
      </section>

      <section className="metric-grid" aria-label={t.personalStatistics}>
        <Metric label={t.availableBalance} value={currency.format(profile.balance_available)} note={t.grossAmount} />
        <Metric label={t.totalEarned} value={currency.format(profile.total_earned)} note={t.grossAmount} />
        <Metric label={t.referralUsers} value={integer.format(profile.referred_num)} note={t.registeredWithCode} />
      </section>

      <section className="referral-card">
        <div><p className="eyebrow dark">{t.referralLink}</p><h2>{t.referralTitle}</h2><p>{t.referralLead}</p></div>
        <div className="referral-actions"><input aria-label={t.referralLink} readOnly value={referralLink} /><button className="btn btn-primary" onClick={() => void copyReferralLink()}>{t.copyLink}</button>{copyState && <span role="status">{copyState}</span>}</div>
      </section>

      {profile.is_manager && (
        <section className="manager-section">
          <SectionHeading eyebrow={t.team} title={t.yourStreamers} detail={t.directMembers(integer.format(dashboard.team_stats?.total_subordinates ?? subordinates.length))} />
          <div className="team-summary">
            <Summary label={t.streamersInTeam} value={integer.format(dashboard.team_stats?.total_subordinates ?? subordinates.length)} />
            <Summary label={t.teamBalance} value={currency.format(dashboard.team_stats?.total_team_balance ?? 0)} />
            <Summary label={t.totalTeamEarned} value={currency.format(dashboard.team_stats?.total_team_earned ?? 0)} />
          </div>
          <div className="table-wrap"><table><thead><tr><th>{t.code}</th><th>{t.balance}</th><th>{t.totalEarned}</th><th>{t.referrals}</th><th aria-label={t.actions} /></tr></thead>
            <tbody>{subordinates.length ? subordinates.map((streamer) => <tr key={streamer.id} className={selectedStreamerId === streamer.id ? "selected" : ""}><td><strong>{streamer.id_code ?? "—"}</strong></td><td>{currency.format(streamer.balance_available)}</td><td>{currency.format(streamer.total_earned)}</td><td>{integer.format(streamer.referred_num)}</td><td><button className="table-action" onClick={() => setSelectedStreamerId((current) => current === streamer.id ? null : streamer.id)}>{selectedStreamerId === streamer.id ? t.showAll : t.viewSubscribers}</button></td></tr>) : <EmptyRow columns={5} message={t.noStreamers} />}</tbody>
          </table></div>
          {(dashboard.subordinates_page?.total_pages ?? 0) > 1 && <Pagination page={dashboard.subordinates_page?.page ?? teamPage} totalPages={dashboard.subordinates_page?.total_pages ?? 1} total={dashboard.subordinates_page?.total ?? subordinates.length} noun={t.streamers} copy={t} integer={integer} onChange={(page) => { setSelectedStreamerId(null); if (token) void load(token, userPage, page); }} />}
        </section>
      )}

      <section className="network-section">
        <SectionHeading eyebrow={t.network} title={selectedStreamer ? t.subscribersOf(selectedStreamer.id_code ?? "") : t.yourSubscribers} detail={selectedStreamer ? t.streamerFilter : t.wholeNetwork} />
        <div className="network-summary">
          <Summary label={t.totalSubscribers} value={integer.format(network.total_users)} />
          <Summary label={t.totalSpent} value={currency.format(network.total_euros_spent)} />
          <Summary label={t.creditsPurchased} value={integer.format(network.total_credits_bought)} />
          <Summary label={t.creditsUsed} value={integer.format(network.total_credits_spent)} />
        </div>
        {selectedStreamer && <button className="clear-filter" onClick={() => setSelectedStreamerId(null)}>{t.clearFilter(selectedStreamer.id_code ?? "")}</button>}
        <UserTable users={visibleUsers} manager={profile.is_manager} sort={sort} onSort={toggleSort} copy={t} currency={currency} integer={integer} formatDate={formatDate} />
        <Pagination page={network.page} totalPages={network.total_pages} total={network.total_users} noun={t.subscribers} copy={t} integer={integer} disabled={Boolean(selectedStreamerId)} onChange={(page) => token && void load(token, page, teamPage)} />
        {selectedStreamerId && <p className="pagination-note">{t.networkPageNote}</p>}
      </section>
      <footer className="portal-footer">{t.footer}</footer>
    </main>
  );
}

function LanguageSwitcher({ locale, onChange }: { locale: Locale; onChange: (locale: Locale) => void }) {
  return <label className="language-switcher"><span className="sr-only">Language</span><select aria-label="Language" value={locale} onChange={(event) => onChange(event.target.value as Locale)}>{LOCALES.map((item) => <option key={item} value={item}>{LOCALE_LABELS[item]}</option>)}</select></label>;
}

function PortalBrand({ compact = false }: { compact?: boolean }) {
  return <a className={`portal-brand ${compact ? "compact" : ""}`} href="/" aria-label="From Zero To Hero"><img src="/logo.webp" alt="" /><span>From Zero To Hero</span></a>;
}

function LoadingScreen({ label, languageSwitcher }: { label: string; languageSwitcher: React.ReactNode }) {
  return <main className="portal-shell loading-shell"><div className="portal-topbar"><PortalBrand />{languageSwitcher}</div><div className="loader"><span className="spinner" /><p>{label}</p></div></main>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="metric-card"><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}
function Summary({ label, value }: { label: string; value: string }) {
  return <div className="summary"><span>{label}</span><strong>{value}</strong></div>;
}
function SectionHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <div className="section-heading"><div><p className="eyebrow dark">{eyebrow}</p><h2>{title}</h2></div><p>{detail}</p></div>;
}
function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return <tr><td colSpan={columns} className="empty-cell">{message}</td></tr>;
}

function UserTable({ users, manager, sort, onSort, copy, currency, integer, formatDate }: { users: NetworkUser[]; manager: boolean; sort: Sort; onSort: (key: SortKey) => void; copy: (typeof COPY)[Locale]; currency: Intl.NumberFormat; integer: Intl.NumberFormat; formatDate: (value?: string | null) => string }) {
  const heading = (key: SortKey, label: string) => <button className={`sort-button ${sort.key === key ? "active" : ""}`} onClick={() => onSort(key)}>{label}<span>{sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button>;
  return <div className="table-wrap users-table"><table><thead><tr><th>{heading("username", copy.user)}</th>{manager && <th>{copy.streamer}</th>}<th>{heading("euros_spent", copy.spent)}</th><th>{heading("credits_bought", copy.creditsPurchased)}</th><th>{heading("credits_spent", copy.creditsUsed)}</th><th>{heading("joined_at", copy.registeredOn)}</th></tr></thead><tbody>{users.length ? users.map((user) => <tr key={user.id}><td><strong>{user.username}</strong><small>{user.email ?? ""}</small></td>{manager && <td>{user.streamer_code ?? "—"}</td>}<td>{currency.format(user.euros_spent)}</td><td>{integer.format(user.credits_bought)}</td><td>{integer.format(user.credits_spent)}</td><td>{formatDate(user.joined_at)}</td></tr>) : <EmptyRow columns={manager ? 6 : 5} message={copy.noSubscribers} />}</tbody></table></div>;
}

function Pagination({ page, totalPages, total, noun, copy, integer, disabled = false, onChange }: { page: number; totalPages: number; total: number; noun: string; copy: (typeof COPY)[Locale]; integer: Intl.NumberFormat; disabled?: boolean; onChange: (page: number) => void }) {
  if (!total || totalPages <= 1) return null;
  return <div className="pagination"><span>{copy.pageSummary(page, totalPages, integer.format(total), noun)}</span><div><button disabled={disabled || page === 1} onClick={() => onChange(page - 1)}>{copy.previous}</button><button disabled={disabled || page === totalPages} onClick={() => onChange(page + 1)}>{copy.next}</button></div></div>;
}
