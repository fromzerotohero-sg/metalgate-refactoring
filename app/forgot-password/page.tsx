"use client";
import { FormEvent, useState } from "react";
import { api, ApiError } from "@/src/lib/api";

export default function ForgotPasswordPage() {
  const initialEmail = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") ?? "";
  const [email, setEmail] = useState(initialEmail);
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try { await api.forgotPassword(email.trim()); setSent(true); setMessage("Se l’account esiste, abbiamo inviato un codice di verifica a questo indirizzo. · If an account exists, we sent a verification code. · Si existe una cuenta, hemos enviado un código de verificación."); }
    catch (error) { setMessage((error as ApiError).message); }
    finally { setBusy(false); }
  }

  return <main className="form-page auth-page"><a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>From Zero To Hero</span></a><section className="form-card auth-card compact-auth"><div className="auth-card-heading"><p className="eyebrow">RECUPERO ACCESSO · ACCOUNT RECOVERY · RECUPERAR ACCESO</p><h1>Rientra nel tuo percorso.</h1><p>Ti invieremo un codice a uso singolo. Per sicurezza, il messaggio è uguale anche se l’email non è registrata.<br /><span className="muted-inline">We’ll send a one-time code. The message is the same for unregistered emails. · Enviaremos un código de un solo uso. El mensaje es igual para emails no registrados.</span></p></div>{!sent ? <form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>{message && <p className="form-error" role="alert">{message}</p>}<button className="button primary" disabled={busy}>{busy ? "Invio… · Sending… · Enviando…" : "Invia codice · Send code · Enviar código"}<span aria-hidden>→</span></button></form> : <div className="mail-note"><strong>Controlla la posta · Check your inbox · Revisa tu correo</strong><span>{message}</span></div>}<div className="auth-actions">{sent && <a className="button primary" href={`/verify-code?email=${encodeURIComponent(email.trim())}`}>Inserisci il codice · Enter code · Introducir código <span aria-hidden>→</span></a>}<a className="form-secondary-link" href="/login">Torna al login · Back to sign in · Volver al acceso</a></div></section></main>;
}
