"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  clearToken,
  saveToken,
  storedToken,
  streamerApi,
  type NetworkResponse,
  type NetworkUser,
  type StreamerDashboard,
  type StreamerProfile,
} from "@/src/lib/api";

type ViewState = "checking" | "login" | "loading" | "ready" | "error";
type SortKey = "username" | "euros_spent" | "credits_bought" | "credits_spent" | "joined_at";
type Sort = { key: SortKey; direction: "asc" | "desc" };

const currency = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const integer = new Intl.NumberFormat("it-IT");
const date = (value?: string | null) => value ? new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(value)) : "—";

function initials(code?: string | null) {
  return (code || "ST").slice(0, 2).toUpperCase();
}

function ordered(users: NetworkUser[], sort: Sort) {
  return [...users].sort((a, b) => {
    const left = sort.key === "joined_at" ? new Date(a.joined_at ?? 0).getTime() : a[sort.key];
    const right = sort.key === "joined_at" ? new Date(b.joined_at ?? 0).getTime() : b[sort.key];
    const result = typeof left === "string" && typeof right === "string"
      ? left.localeCompare(right, "it")
      : Number(left ?? 0) - Number(right ?? 0);
    return sort.direction === "asc" ? result : -result;
  });
}

export default function StreamerPortal() {
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
        setLoginError("La sessione è scaduta. Accedi di nuovo.");
        return;
      }
      setLoadError(error instanceof Error ? error.message : "Non è stato possibile caricare la dashboard.");
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
      setLoginError(error instanceof Error ? error.message : "Accesso non riuscito.");
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
    return ordered(selectedStreamerId ? users.filter((user) => user.streamer_id === selectedStreamerId) : users, sort);
  }, [network?.users, selectedStreamerId, sort]);
  const signupUrl = process.env.NEXT_PUBLIC_SIGNUP_URL ?? "/register";
  const referralLink = profile?.id_code ? `${signupUrl}${signupUrl.includes("?") ? "&" : "?"}ref=${encodeURIComponent(profile.id_code)}` : "";

  async function copyReferralLink() {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopyState("Link copiato.");
    } catch {
      setCopyState("Copia il link dal campo qui sopra.");
    }
    window.setTimeout(() => setCopyState(""), 2600);
  }

  if (state === "checking" || state === "loading") {
    return <LoadingScreen label={state === "checking" ? "Verifica della sessione…" : "Caricamento della dashboard…"} />;
  }

  if (state === "login") {
    return (
      <main className="portal-shell auth-shell">
        <PortalBrand />
        <section className="login-layout">
          <div className="login-copy">
            <p className="eyebrow">Portale partner</p>
            <h1>Il tuo network.<br /><em>Tutto sotto controllo.</em></h1>
            <p>Accedi con le credenziali streamer per visualizzare risultati, referral e andamento del tuo team.</p>
            <ul>
              <li>Guadagni e saldo disponibili</li>
              <li>Panoramica completa dei referral</li>
              <li>Monitoraggio del team manageriale</li>
            </ul>
          </div>
          <section className="login-card" aria-labelledby="login-title">
            <div className="login-avatar" aria-hidden>{initials(idCode)}</div>
            <h2 id="login-title">Accedi al portale</h2>
            <p>Usa il codice e la password ricevuti dal team.</p>
            <form onSubmit={submit}>
              <label className="field-label" htmlFor="streamer-code">Codice streamer</label>
              <input id="streamer-code" className="field-input" autoComplete="username" placeholder="Es. NICK2024" value={idCode} onChange={(event) => setIdCode(event.target.value.toUpperCase())} required />
              <label className="field-label" htmlFor="streamer-password">Password</label>
              <div className="password-field">
                <input id="streamer-password" className="field-input" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••" value={password} onChange={(event) => setPassword(event.target.value)} required />
                <button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Nascondi" : "Mostra"}</button>
              </div>
              {loginError && <p className="form-error" role="alert">{loginError}</p>}
              <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Accesso in corso…" : "Accedi al portale"} <span aria-hidden>→</span></button>
            </form>
            <p className="login-security">La sessione resta attiva solo in questa scheda del browser.</p>
          </section>
        </section>
      </main>
    );
  }

  if (state === "error" || !profile || !network) {
    return (
      <main className="portal-shell error-shell">
        <PortalBrand />
        <section className="error-panel">
          <p className="eyebrow">Errore di caricamento</p>
          <h1>Non riusciamo a mostrare i tuoi dati.</h1>
          <p>{loadError || "Riprova tra qualche istante."}</p>
          <div className="error-actions">
            <button className="btn btn-primary" onClick={() => token && void load(token, userPage, teamPage)}>Riprova</button>
            <button className="btn btn-outline" onClick={logout}>Esci</button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="portal-shell dashboard-shell">
      <header className="portal-header">
        <PortalBrand compact />
        <div className="portal-user">
          <span className="user-avatar">{initials(profile.id_code)}</span>
          <div><strong>{profile.id_code}</strong><small>{profile.is_manager ? "Manager" : "Streamer partner"}</small></div>
          <button className="logout" onClick={logout}>Esci</button>
        </div>
      </header>

      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">Panoramica</p>
          <h1>Ciao, <em>{profile.id_code}</em></h1>
          <p>Monitora le entrate e la crescita della tua community.</p>
        </div>
        <div className="code-chip"><span>Codice referral</span><strong>{profile.id_code}</strong></div>
      </section>

      <section className="metric-grid" aria-label="Statistiche personali">
        <Metric label="Saldo disponibile" value={currency.format(profile.balance_available)} note="Importo lordo" />
        <Metric label="Totale guadagnato" value={currency.format(profile.total_earned)} note="Importo lordo" />
        <Metric label="Utenti referral" value={integer.format(profile.referred_num)} note="Registrati con il tuo codice" />
      </section>

      <section className="referral-card">
        <div><p className="eyebrow dark">Link referral</p><h2>Condividi il tuo invito</h2><p>Chi si registra con questo link verrà attribuito automaticamente al tuo profilo.</p></div>
        <div className="referral-actions"><input aria-label="Link referral" readOnly value={referralLink} /><button className="btn btn-primary" onClick={() => void copyReferralLink()}>Copia link</button>{copyState && <span role="status">{copyState}</span>}</div>
      </section>

      {profile.is_manager && (
        <section className="manager-section">
          <SectionHeading eyebrow="Team" title="I tuoi streamer" detail={`${integer.format(dashboard.team_stats?.total_subordinates ?? subordinates.length)} membri diretti`} />
          <div className="team-summary">
            <Summary label="Streamer nel team" value={integer.format(dashboard.team_stats?.total_subordinates ?? subordinates.length)} />
            <Summary label="Saldo team" value={currency.format(dashboard.team_stats?.total_team_balance ?? 0)} />
            <Summary label="Totale guadagnato team" value={currency.format(dashboard.team_stats?.total_team_earned ?? 0)} />
          </div>
          <div className="table-wrap"><table><thead><tr><th>Codice</th><th>Saldo</th><th>Totale guadagnato</th><th>Referral</th><th aria-label="Azioni" /></tr></thead>
            <tbody>{subordinates.length ? subordinates.map((streamer) => <tr key={streamer.id} className={selectedStreamerId === streamer.id ? "selected" : ""}><td><strong>{streamer.id_code ?? "—"}</strong></td><td>{currency.format(streamer.balance_available)}</td><td>{currency.format(streamer.total_earned)}</td><td>{integer.format(streamer.referred_num)}</td><td><button className="table-action" onClick={() => setSelectedStreamerId((current) => current === streamer.id ? null : streamer.id)}>{selectedStreamerId === streamer.id ? "Mostra tutti" : "Vedi iscritti"}</button></td></tr>) : <EmptyRow columns={5} message="Non ci sono ancora streamer nel tuo team." />}</tbody>
          </table></div>
          {(dashboard.subordinates_page?.total_pages ?? 0) > 1 && (
            <TeamPagination
              page={dashboard.subordinates_page?.page ?? teamPage}
              totalPages={dashboard.subordinates_page?.total_pages ?? 1}
              total={dashboard.subordinates_page?.total ?? subordinates.length}
              onChange={(page) => {
                setSelectedStreamerId(null);
                if (token) void load(token, userPage, page);
              }}
            />
          )}
        </section>
      )}

      <section className="network-section">
        <SectionHeading eyebrow="Network" title={selectedStreamer ? `Iscritti di ${selectedStreamer.id_code}` : "I tuoi iscritti"} detail={selectedStreamer ? "Filtro per streamer selezionato" : "Tutta la tua rete, inclusi i referral del team"} />
        <div className="network-summary">
          <Summary label="Iscritti totali" value={integer.format(network.total_users)} />
          <Summary label="Totale speso" value={currency.format(network.total_euros_spent)} />
          <Summary label="Crediti acquistati" value={integer.format(network.total_credits_bought)} />
          <Summary label="Crediti utilizzati" value={integer.format(network.total_credits_spent)} />
        </div>
        {selectedStreamer && <button className="clear-filter" onClick={() => setSelectedStreamerId(null)}>× Rimuovi filtro {selectedStreamer.id_code}</button>}
        <UserTable users={visibleUsers} manager={profile.is_manager} sort={sort} onSort={toggleSort} />
        <Pagination page={network.page} totalPages={network.total_pages} total={network.total_users} disabled={Boolean(selectedStreamerId)} onChange={(page) => token && void load(token, page, teamPage)} />
        {selectedStreamerId && <p className="pagination-note">Il filtro mostra i risultati presenti nella pagina corrente della rete.</p>}
      </section>
      <footer className="portal-footer">From Zero To Hero · Portale Streamer</footer>
    </main>
  );
}

function PortalBrand({ compact = false }: { compact?: boolean }) {
  return <a className={`portal-brand ${compact ? "compact" : ""}`} href="/" aria-label="From Zero To Hero"><img src="/logo.webp" alt="" /><span>From Zero To Hero</span></a>;
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="portal-shell loading-shell"><PortalBrand /><div className="loader"><span className="spinner" /><p>{label}</p></div></main>;
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

function UserTable({ users, manager, sort, onSort }: { users: NetworkUser[]; manager: boolean; sort: Sort; onSort: (key: SortKey) => void }) {
  const heading = (key: SortKey, label: string) => <button className={`sort-button ${sort.key === key ? "active" : ""}`} onClick={() => onSort(key)}>{label}<span>{sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button>;
  return <div className="table-wrap users-table"><table><thead><tr><th>{heading("username", "Utente")}</th>{manager && <th>Streamer</th>}<th>{heading("euros_spent", "Spesa")}</th><th>{heading("credits_bought", "Crediti acquistati")}</th><th>{heading("credits_spent", "Crediti utilizzati")}</th><th>{heading("joined_at", "Registrato il")}</th></tr></thead><tbody>{users.length ? users.map((user) => <tr key={user.id}><td><strong>{user.username}</strong><small>{user.email ?? ""}</small></td>{manager && <td>{user.streamer_code ?? "—"}</td>}<td>{currency.format(user.euros_spent)}</td><td>{integer.format(user.credits_bought)}</td><td>{integer.format(user.credits_spent)}</td><td>{date(user.joined_at)}</td></tr>) : <EmptyRow columns={manager ? 6 : 5} message="Nessun iscritto da mostrare." />}</tbody></table></div>;
}

function Pagination({ page, totalPages, total, disabled, onChange }: { page: number; totalPages: number; total: number; disabled: boolean; onChange: (page: number) => void }) {
  if (!total || totalPages <= 1) return null;
  return <div className="pagination"><span>Pagina {page} di {totalPages} · {integer.format(total)} iscritti</span><div><button disabled={disabled || page === 1} onClick={() => onChange(page - 1)}>← Precedente</button><button disabled={disabled || page === totalPages} onClick={() => onChange(page + 1)}>Successiva →</button></div></div>;
}

function TeamPagination({ page, totalPages, total, onChange }: { page: number; totalPages: number; total: number; onChange: (page: number) => void }) {
  return <div className="pagination"><span>Pagina {page} di {totalPages} · {integer.format(total)} streamer</span><div><button disabled={page === 1} onClick={() => onChange(page - 1)}>← Precedente</button><button disabled={page === totalPages} onClick={() => onChange(page + 1)}>Successiva →</button></div></div>;
}
