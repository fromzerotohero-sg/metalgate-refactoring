"use client";

import { useState } from "react";
import { adminApi, AdminApiError } from "@/src/lib/admin-api";

export default function GrantCreditsForm({ userId, onGranted }: { userId: string; onGranted: () => void }) {
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = parseInt(amount, 10);
    if (!Number.isInteger(value) || value <= 0) {
      setMessage({ kind: "err", text: "Inserisci un numero di crediti valido." });
      return;
    }
    if (!window.confirm(`Accreditare ${value} crediti a questo utente?`)) return;

    setBusy(true);
    setMessage(null);
    try {
      await adminApi.grantCredits(userId, {
        amount: value,
        reason: reason.trim() || undefined,
        expires_in_days: days ? parseInt(days, 10) : undefined
      });
      setMessage({ kind: "ok", text: `${value} crediti accreditati.` });
      setAmount("");
      setDays("");
      setReason("");
      onGranted();
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof AdminApiError ? err.message : "Accredito fallito." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-grant-form" onSubmit={submit}>
      <div className="admin-grant-fields">
        <label className="field">
          <span className="field-label">Crediti *</span>
          <span className="field-input">
            <input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </span>
        </label>
        <label className="field">
          <span className="field-label">Validità (giorni)</span>
          <span className="field-input">
            <input type="number" min="1" step="1" placeholder="Default" value={days} onChange={(e) => setDays(e.target.value)} />
          </span>
        </label>
        <label className="field">
          <span className="field-label">Motivo</span>
          <span className="field-input">
            <input type="text" placeholder="Bonus admin" value={reason} onChange={(e) => setReason(e.target.value)} />
          </span>
        </label>
      </div>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Accredito…" : "Accredita crediti"}
      </button>
      {message && <p className={message.kind === "ok" ? "admin-ok" : "admin-error"}>{message.text}</p>}
    </form>
  );
}
