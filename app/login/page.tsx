"use client";
import { FormEvent, useEffect, useState } from "react";
import { api, ApiError } from "@/src/lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => { api.session().then(() => { window.location.href = "/account"; }).catch(() => undefined); }, []);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setMessage(""); try { await api.login({ email, password }); window.location.href = "/account"; } catch (error) { const e = error as ApiError; setMessage(e.payload?.requires_verification ? "Email non verificata: puoi richiedere un nuovo invio dalla registrazione." : e.message); } finally { setBusy(false); } }
  return <main className="form-page"><a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>From Zero To Hero</span></a><section className="form-card"><p className="eyebrow">BENTORNATO</p><h1>Accedi al tuo ecosistema.</h1><form onSubmit={submit}><label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>{message && <p className="form-error">{message}</p>}<button className="button primary" disabled={busy}>{busy ? "Accesso…" : "Accedi"}</button></form><a href="/forgot-password">Hai dimenticato la password?</a><p>Non hai un account? <a href="/register">Inizia ora</a></p></section></main>;
}
