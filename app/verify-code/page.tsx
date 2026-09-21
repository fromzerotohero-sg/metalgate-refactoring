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
    try { const result = await api.verifyResetCode({ email: email.trim(), code: code.replace(/\D/g, "").slice(0, 6) }) as { reset_token?: string }; if (!result.reset_token) throw new Error("Codice non valido · Invalid code · Código no válido."); window.location.href = `/reset-password?token=${encodeURIComponent(result.reset_token)}`; }
    catch (error) { setMessage(`${(error as ApiError).message || "Codice errato o scaduto."} · Invalid or expired code. · Código incorrecto o caducado.`); }
    finally { setBusy(false); }
  }

  async function resend() {
    if (!email.trim()) { setMessage("Inserisci prima l’email dell’account. · Enter your account email first. · Introduce primero el email de tu cuenta."); return; }
    setResending(true); setMessage("");
    try { await api.forgotPassword(email.trim()); setSent(true); setMessage("Se l’account esiste, abbiamo inviato un nuovo codice. · If an account exists, we sent a new code. · Si existe una cuenta, hemos enviado un código nuevo."); }
    catch (error) { setMessage((error as ApiError).message); }
    finally { setResending(false); }
  }

  return <main className="form-page auth-page"><a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>From Zero To Hero</span></a><section className="form-card auth-card compact-auth"><div className="auth-card-heading"><p className="eyebrow">VERIFICA CODICE · VERIFY CODE · VERIFICAR CÓDIGO</p><h1>Un ultimo passaggio.</h1><p>Inserisci il codice a 6 cifre ricevuto via email. Rimane valido per 15 minuti.<br /><span className="muted-inline">Enter the 6-digit code from your email. Valid for 15 minutes. · Introduce el código de 6 dígitos. Válido durante 15 minutos.</span></p></div><form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Codice di verifica · Verification code · Código de verificación<input className="code-input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></label>{message && <p className="form-error" role="alert">{message}</p>}<button className="button primary" disabled={busy}>{busy ? "Verifica… · Verifying… · Verificando…" : "Verifica codice · Verify code · Verificar código"}<span aria-hidden>→</span></button></form><div className="auth-actions"><button type="button" className="resend-link" onClick={resend} disabled={resending}>{resending ? "Invio… · Sending… · Enviando…" : sent ? "Invia un nuovo codice · Send a new code · Enviar un código nuevo" : "Non hai ricevuto il codice? · Didn’t receive the code? · ¿No recibiste el código?"}</button><a className="form-secondary-link" href="/login">Torna al login · Back to sign in · Volver al acceso</a></div>{emailQuery && <p className="field-hint">Codice inviato a {emailQuery} · Code sent to {emailQuery} · Código enviado a {emailQuery}</p>}</section></main>;
}
