"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/src/lib/api";

function safeReturnTo(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/account";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const returnTo = useMemo(() => typeof window === "undefined" ? "/account" : safeReturnTo(new URLSearchParams(window.location.search).get("return_to")), []);

  useEffect(() => {
    api.session().then(() => { window.location.href = returnTo; }).catch(() => setChecking(false));
  }, [returnTo]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setVerificationRequired(false);
    try {
      await api.login({ email: email.trim(), password });
      window.location.href = returnTo;
    } catch (error) {
      const caught = error as ApiError;
      setVerificationRequired(Boolean(caught.payload?.requires_verification));
      setMessage(caught.payload?.requires_verification ? "Prima di entrare, verifica l’indirizzo email collegato al tuo account. · Verify your email before signing in. · Verifica tu email antes de entrar." : `${caught.message} · Sign-in failed. · No se pudo iniciar sesión.`);
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setMessage("");
    try {
      await api.sendVerification({ email: email.trim(), redirect: `${window.location.origin}/verify-email` });
      setMessage("Se l’account è in attesa, ti abbiamo inviato una nuova email di verifica. · If your account is pending, a new verification email is on its way. · Si tu cuenta está pendiente, recibirás un nuevo email de verificación.");
      setVerificationRequired(false);
    } catch (error) {
      setMessage((error as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  if (checking) return <main className="form-page"><div className="auth-loading"><img src="/logo.webp" alt="From Zero To Hero" /><span>Prepariamo il tuo accesso… · Preparing your access… · Preparando tu acceso…</span></div></main>;

  return <main className="form-page auth-page">
    <a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>From Zero To Hero</span></a>
    <div className="auth-layout">
      <section className="auth-story" aria-label="Perché accedere">
        <p className="eyebrow">IL TUO SPAZIO PERSONALE</p>
        <h1>Riprendi il filo.<br /><span>Gioca meglio.</span></h1>
        <p>Un accesso, tutte le tue piattaforme, ogni miglioramento sempre al posto giusto.<br /><span className="muted-inline">One access, every platform, every improvement in place. · Un acceso, todas tus plataformas y cada mejora en su sitio.</span></p>
        <div className="auth-proof"><span>01</span><div><strong>Il tuo percorso · Your journey · Tu recorrido</strong><small>riparte da dove l’avevi lasciato · picks up where you left off · continúa donde lo dejaste</small></div></div>
        <div className="auth-proof"><span>02</span><div><strong>Le tue scelte · Your choices · Tus decisiones</strong><small>restano sotto il tuo controllo · stay in your control · siempre bajo tu control</small></div></div>
      </section>
      <section className="form-card auth-card">
        <div className="auth-card-heading"><p className="eyebrow">BENTORNATO · WELCOME BACK · BIENVENIDO</p><h2>Accedi al tuo ecosistema.</h2><p>Inserisci le credenziali per continuare. · Enter your credentials to continue. · Introduce tus credenciales para continuar.</p></div>
        <form onSubmit={submit}>
          <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<div className="password-field"><input type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Nascondi" : "Mostra"}</button></div></label>
          {message && <p className="form-error" role="alert">{message}</p>}
          {verificationRequired && <button type="button" className="resend-link" onClick={resendVerification} disabled={busy}>Invia di nuovo l’email di verifica · Resend verification email · Reenviar email de verificación</button>}
          <button className="button primary" disabled={busy}>{busy ? "Accesso… · Signing in… · Entrando…" : "Accedi · Sign in · Entrar"}<span aria-hidden>→</span></button>
        </form>
        <a className="form-secondary-link" href={`/forgot-password?email=${encodeURIComponent(email)}`}>Hai dimenticato la password? · Forgot password? · ¿Olvidaste tu contraseña?</a>
        <p className="auth-switch">Non hai un account? · No account? · ¿No tienes cuenta? <a href={`/register?return_to=${encodeURIComponent(returnTo)}`}>Inizia ora · Start now · Empezar</a></p>
      </section>
    </div>
  </main>;
}
