"use client";

import { useState } from "react";
import { AdminApiError } from "@/src/lib/admin-api";
import { useAdmin } from "@/src/lib/admin-auth";

function errorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 401) {
      // L'API distingue i due fattori; appiattirli su un solo messaggio fa cercare
      // il problema dalla parte sbagliata (codice admin vs authenticator).
      if (/second factor/i.test(error.message)) return "Codice authenticator non valido o scaduto.";
      if (/admin code/i.test(error.message)) return "Codice admin non valido.";
      return "Codice admin o codice authenticator non valido.";
    }
    if (error.status === 403) return "Accesso negato da questo indirizzo IP.";
    if (error.status === 429) return "Troppi tentativi. Riprova tra un minuto.";
    if (error.status === 503) return "Il pannello non è configurato sul server.";
  }
  return "Errore di connessione. Riprova.";
}

export default function LoginGate() {
  const { login, hasStoredCode } = useAdmin();
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Con un codice già memorizzato il campo è nascosto; "Usa un altro codice" lo
  // riapre, così un codice ruotato non lascia l'operatore chiuso fuori.
  const [wantsNewCode, setWantsNewCode] = useState(false);
  const showCode = !hasStoredCode || wantsNewCode;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(code, totp);
    } catch (err) {
      setError(errorMessage(err));
      setTotp("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-gate-wrap">
      <div className="auth-card admin-gate">
        <img src="/logo.webp" alt="" width={44} height={44} />
        <h1>Pannello di controllo</h1>
        <p className="auth-card-lead">
          {hasStoredCode
            ? "La sessione è scaduta. Inserisci di nuovo il codice authenticator."
            : "Area riservata. Inserisci il codice admin per entrare."}
        </p>
        <form onSubmit={submit}>
          {showCode && (
            <label className="field">
              <span className="field-label">Codice admin</span>
              <span className="field-input">
                <input
                  type="password"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="off"
                  autoFocus
                  required
                />
              </span>
            </label>
          )}
          <label className="field">
            <span className="field-label">Codice authenticator (solo se configurato)</span>
            <span className="field-input">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="Lascia vuoto se non ce l'hai"
                value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                autoComplete="one-time-code"
              />
            </span>
          </label>
          {hasStoredCode && !wantsNewCode && (
            <button type="button" className="admin-gate-alt" onClick={() => setWantsNewCode(true)}>
              Usa un altro codice
            </button>
          )}
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy || (showCode && !code) || (totp.length > 0 && totp.length !== 6)}>
            {busy ? "Verifica…" : "Entra"}
          </button>
        </form>
      </div>
    </div>
  );
}
