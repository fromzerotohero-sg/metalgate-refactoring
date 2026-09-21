"use client";

import { FormEvent, useMemo, useState } from "react";
import { api, ApiError } from "@/src/lib/api";

function safeReturnTo(value: string | null) { return value && value.startsWith("/") && !value.startsWith("//") ? value : "/account"; }

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [tag, setTag] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [showOptional, setShowOptional] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [deliveryFailed, setDeliveryFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const returnTo = useMemo(() => typeof window === "undefined" ? "/account" : safeReturnTo(new URLSearchParams(window.location.search).get("return_to")), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < 8) { setMessage("La password deve avere almeno 8 caratteri. · Password must be at least 8 characters. · La contraseña debe tener al menos 8 caracteres."); return; }
    setBusy(true); setMessage(""); setDeliveryFailed(false);
    try {
      const response = await api.register({ email: email.trim(), password, username: username.trim() || undefined, tag: tag.trim() || undefined, referral_code: referralCode.trim() || undefined, redirect: `${window.location.origin}/verify-email` }) as { verification_email_sent?: boolean };
      setDeliveryFailed(response.verification_email_sent === false);
      setDone(true);
      setMessage(response.verification_email_sent === false ? "L’account è stato creato, ma l’email non è partita. Puoi richiederne un nuovo invio. · Your account was created, but the email failed. Request a new one. · La cuenta se creó, pero el email falló. Solicita uno nuevo." : "Ti abbiamo inviato il link di verifica. · We sent you a verification link. · Te hemos enviado un enlace de verificación.");
    } catch (error) { setMessage((error as ApiError).message); }
    finally { setBusy(false); }
  }

  async function resendVerification() {
    setBusy(true);
    try { await api.sendVerification({ email: email.trim(), redirect: `${window.location.origin}/verify-email` }); setDeliveryFailed(false); setMessage("Se l’account è in attesa, la nuova email è in arrivo. · If the account is pending, a new email is on its way. · Si la cuenta está pendiente, recibirás un nuevo email."); }
    catch (error) { setMessage((error as ApiError).message); }
    finally { setBusy(false); }
  }

  return <main className="form-page auth-page">
    <a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>From Zero To Hero</span></a>
    <div className="auth-layout">
      <section className="auth-story" aria-label="Vantaggi dell’account">
        <p className="eyebrow">INIZIA IL TUO PERCORSO</p>
        <h1>Costruisci il tuo<br /><span>vantaggio.</span></h1>
        <p>Un profilo leggero per entrare nelle piattaforme, seguire i progressi e avere sempre chiaro il prossimo passo.<br /><span className="muted-inline">A lightweight profile for every platform and next step. · Un perfil sencillo para cada plataforma y siguiente paso.</span></p>
        <div className="journey-steps"><span className="active">01 <b>Crea</b></span><i /><span>02 <b>Verifica</b></span><i /><span>03 <b>Inizia</b></span></div>
      </section>
      <section className="form-card auth-card">
        {done ? <>
          <div className="success-mark" aria-hidden>✓</div><p className="eyebrow">QUASI FATTO · ALMOST THERE · CASI LISTO</p><h2>Controlla la tua email.</h2><p className="auth-description">{message}</p><div className="mail-note"><strong>{email}</strong><span>Il link è valido per il tempo indicato nell’email. · The link is valid for the time stated in the email. · El enlace es válido durante el tiempo indicado en el email.</span></div>{deliveryFailed && <button type="button" className="button ghost" onClick={resendVerification} disabled={busy}>{busy ? "Invio… · Sending… · Enviando…" : "Invia di nuovo · Resend · Reenviar"}</button>}<a className="button primary" href={`/login?return_to=${encodeURIComponent(returnTo)}`}>Torna all’accesso · Back to sign in · Volver al acceso <span aria-hidden>→</span></a>
        </> : <>
          <div className="auth-card-heading"><p className="eyebrow">IL TUO PERCORSO · YOUR JOURNEY · TU RECORRIDO</p><h2>Crea il tuo accesso.</h2><p>Servono meno di due minuti. Nessun passaggio bloccante. · Under two minutes. No blocking steps. · Menos de dos minutos. Sin pasos bloqueantes.</p></div>
          <form onSubmit={submit}>
            <label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label>Password<input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /><small className="field-hint">Almeno 8 caratteri · At least 8 characters · Al menos 8 caracteres</small></label>
            <label>Nome utente <span className="optional">opzionale</span><input autoComplete="nickname" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Come vuoi essere riconosciuto" /></label>
            <button type="button" className="optional-toggle" onClick={() => setShowOptional((value) => !value)}>{showOptional ? "Nascondi dettagli opzionali" : "Aggiungi tag o codice invito"} <span aria-hidden>{showOptional ? "↑" : "↓"}</span></button>
            {showOptional && <div className="optional-fields"><label>Tag <span className="optional">opzionale</span><input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="es. 1234" /></label><label>Codice invito <span className="optional">opzionale</span><input value={referralCode} onChange={(event) => setReferralCode(event.target.value)} /></label></div>}
            {message && <p className="form-error" role="alert">{message}</p>}
            <button className="button primary" disabled={busy}>{busy ? "Creazione… · Creating… · Creando…" : "Crea account · Create account · Crear cuenta"}<span aria-hidden>→</span></button>
          </form>
          <p className="terms-note">Creando l’account accetti i <a href="/legal/terms">Termini · Terms · Términos</a> e la <a href="/legal/privacy">Privacy · Privacidad</a>.</p><p className="auth-switch">Hai già un account? · Already have an account? · ¿Ya tienes cuenta? <a href={`/login?return_to=${encodeURIComponent(returnTo)}`}>Accedi · Sign in · Entrar</a></p>
        </>}
      </section>
    </div>
  </main>;
}
