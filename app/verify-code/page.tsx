"use client";

import { FormEvent, useMemo, useState } from "react";
import { api, ApiError } from "@/src/lib/api";

export default function VerifyCodePage() {
  const [email, setEmail] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") ?? "");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);
  const emailQuery = useMemo(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") ?? "", []);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { const result = await api.verifyResetCode({ email: email.trim(), code: code.replace(/\D/g, "").slice(0, 6) }) as { reset_token?: string }; if (!result.reset_token) throw new Error("Codice non valido."); window.location.href = `/reset-password?token=${encodeURIComponent(result.reset_token)}`; }
    catch (error) { setMessage((error as ApiError).message || "Codice errato o scaduto."); }
    finally { setBusy(false); }
  }

  async function resend() {
    if (!email.trim()) { setMessage("Inserisci prima l’email dell’account."); return; }
    setResending(true); setMessage("");
    try { await api.forgotPassword(email.trim()); setSent(true); setMessage("Se l’account esiste, abbiamo inviato un nuovo codice."); }
    catch (error) { setMessage((error as ApiError).message); }
    finally { setResending(false); }
  }

  return <main className="form-page auth-page"><a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>From Zero To Hero</span></a><section className="form-card auth-card compact-auth"><div className="auth-card-heading"><p className="eyebrow">VERIFICA CODICE</p><h1>Un ultimo passaggio.</h1><p>Inserisci il codice a 6 cifre ricevuto via email. Rimane valido per 15 minuti.</p></div><form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Codice di verifica<input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>{message && <p className="form-error" role="alert">{message}</p>}<button className="button primary" disabled={busy}>{busy ? "Verifica…" : "Verifica codice"}<span aria-hidden>→</span></button></form><div className="auth-actions"><button type="button" className="resend-link" onClick={resend} disabled={resending}>{resending ? "Invio…" : sent ? "Invia un nuovo codice" : "Non hai ricevuto il codice?"}</button><a className="form-secondary-link" href="/login">Torna al login</a></div>{emailQuery && <p className="field-hint">Codice inviato a {emailQuery}</p>}</section></main>;
}
