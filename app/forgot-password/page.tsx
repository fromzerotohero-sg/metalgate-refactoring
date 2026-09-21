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
    try { await api.forgotPassword(email.trim()); setSent(true); setMessage("Se l’account esiste, abbiamo inviato un codice di verifica a questo indirizzo."); }
    catch (error) { setMessage((error as ApiError).message); }
    finally { setBusy(false); }
  }

  return <main className="form-page auth-page"><a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>From Zero To Hero</span></a><section className="form-card auth-card compact-auth"><div className="auth-card-heading"><p className="eyebrow">RECUPERO ACCESSO</p><h1>Rientra nel tuo percorso.</h1><p>Ti invieremo un codice a uso singolo. Per sicurezza, il messaggio è uguale anche se l’email non è registrata.</p></div>{!sent ? <form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>{message && <p className="form-error" role="alert">{message}</p>}<button className="button primary" disabled={busy}>{busy ? "Invio…" : "Invia codice"}<span aria-hidden>→</span></button></form> : <div className="mail-note"><strong>Controlla la posta</strong><span>{message}</span></div>}<div className="auth-actions">{sent && <a className="button primary" href={`/verify-code?email=${encodeURIComponent(email.trim())}`}>Inserisci il codice <span aria-hidden>→</span></a>}<a className="form-secondary-link" href="/login">Torna al login</a></div></section></main>;
}
