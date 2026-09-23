"use client";

import { useState } from "react";
import { AdminApiError } from "@/src/lib/admin-api";
import { useAdmin } from "@/src/lib/admin-auth";

function errorMessage(error: unknown): string {
  if (error instanceof AdminApiError) {
    if (error.status === 401) return "Codice admin non valido.";
    if (error.status === 403) return "Accesso negato da questo indirizzo IP.";
    if (error.status === 429) return "Troppi tentativi. Riprova tra un minuto.";
    if (error.status === 503) return "Il pannello non è configurato sul server.";
  }
  return "Errore di connessione. Riprova.";
}

export default function LoginGate() {
  const { login } = useAdmin();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(code);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-gate-wrap">
      <div className="auth-card admin-gate">
        <img src="/logo.webp" alt="" width={44} height={44} />
        <h1>Pannello di controllo</h1>
        <p className="auth-card-lead">Area riservata. Inserisci il codice admin per entrare.</p>
        <form onSubmit={submit}>
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
          {error && (
            <p className="admin-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy || !code}>
            {busy ? "Verifica…" : "Entra"}
          </button>
        </form>
      </div>
    </div>
  );
}
