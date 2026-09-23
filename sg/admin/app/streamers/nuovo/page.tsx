"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminApiError, adminApi } from "@/src/lib/admin-api";
import { useToast } from "@/src/components/admin/toast";

export default function NuovoStreamerPage() {
  const router = useRouter();
  const toast = useToast();
  const [idCode, setIdCode] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [managerCode, setManagerCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = idCode.trim();
    if (code.length < 3) {
      setFormError("Il codice deve contenere almeno 3 caratteri.");
      return;
    }
    if (password.length < 6) {
      setFormError("La password deve contenere almeno 6 caratteri.");
      return;
    }
    if (password !== passwordConfirm) {
      setFormError("Le password non coincidono.");
      return;
    }

    setBusy(true);
    setFormError(null);
    try {
      const res = await adminApi.createStreamer({
        id_code: code,
        password,
        manager_code: managerCode.trim() || undefined
      });
      toast.success(`Streamer creato — codice ${code} (ID ${res.streamer_id})`);
      router.push(`/streamers/${res.streamer_id}`);
    } catch (err) {
      const message = err instanceof AdminApiError ? err.message : "Creazione streamer fallita.";
      setFormError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-page">
      <Link href="/streamers" className="admin-back">
        ← Tutti gli streamer
      </Link>

      <h1 className="admin-title">Nuovo streamer</h1>

      <section className="admin-card max-w-xl">
        <form className="admin-grant-form" onSubmit={submit}>
          <label className="field">
            <span className="field-label">Codice streamer *</span>
            <span className="field-input">
              <input
                type="text"
                value={idCode}
                onChange={(e) => setIdCode(e.target.value)}
                placeholder="es. streamer-mario"
                minLength={3}
                required
                autoFocus
              />
            </span>
          </label>
          <label className="field">
            <span className="field-label">Password *</span>
            <span className="field-input">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                autoComplete="new-password"
              />
            </span>
          </label>
          <label className="field">
            <span className="field-label">Conferma password *</span>
            <span className="field-input">
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                minLength={6}
                required
                autoComplete="new-password"
              />
            </span>
          </label>
          <label className="field">
            <span className="field-label">Codice manager (opzionale)</span>
            <span className="field-input">
              <input
                type="text"
                value={managerCode}
                onChange={(e) => setManagerCode(e.target.value)}
                placeholder="Codice del manager che lo gestisce"
              />
            </span>
          </label>

          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Creazione…" : "Crea streamer"}
          </button>
          {formError && <p className="admin-error">{formError}</p>}
        </form>
      </section>
    </div>
  );
}
