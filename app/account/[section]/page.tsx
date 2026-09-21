"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError } from "@/src/lib/api";
import { isLocalPreview, previewAccount } from "@/src/lib/preview";

const titles: Record<string, { eyebrow: string; title: string; intro: string }> = {
  profile: { eyebrow: "IDENTITÀ · IDENTITY · IDENTIDAD", title: "Il tuo profilo.", intro: "Un’identità riconoscibile in tutto l’ecosistema. · One identity across the ecosystem. · Una identidad en todo el ecosistema." },
  subscription: { eyebrow: "PIANO · PLAN", title: "Tutto sotto controllo.", intro: "Piano, utilizzo e abbonamento in un unico posto. · Plan, usage and subscription in one place. · Plan, uso y suscripción en un solo lugar." },
  security: { eyebrow: "SICUREZZA · SECURITY · SEGURIDAD", title: "Proteggi il tuo accesso.", intro: "Gestisci password e dispositivi. · Manage passwords and devices. · Gestiona contraseñas y dispositivos." },
  transactions: { eyebrow: "ATTIVITÀ · ACTIVITY · ACTIVIDAD", title: "Il tuo percorso.", intro: "Le operazioni recenti, a colpo d’occhio. · Recent activity at a glance. · Actividad reciente de un vistazo." }
};

export default function AccountSectionPage() {
  const { section } = useParams<{ section: string }>();
  const preview = isLocalPreview();
  const content = titles[section] ?? titles.profile;
  const [data, setData] = useState<any>();
  const [user, setUser] = useState<any>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [tag, setTag] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const load = async () => {
    setBusy(true); setMessage("");
    try {
      if (isLocalPreview()) {
        if (section === "profile") { setUser(previewAccount.me); setUsername(previewAccount.me.username); setTag(previewAccount.me.tag); }
        else if (section === "subscription") setData(previewAccount.credits);
        else if (section === "security") setData({ sessions: previewAccount.sessions });
        else setData({ transactions: previewAccount.transactions });
        return;
      }
      if (section === "profile") { const result: any = await api.me(); setUser(result); setUsername(result.username ?? ""); setTag(result.tag ?? ""); }
      else if (section === "subscription") setData(await api.credits());
      else if (section === "security") setData(await api.authSessions());
      else setData(await api.transactions());
    } catch (error) {
      const e = error as ApiError;
      if (e.status === 401) window.location.href = `/login?return_to=/account/${section}`;
      else setMessage(`${e.message} · Request failed. · La solicitud ha fallado.`);
    } finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [section]);

  async function saveProfile(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try { await api.profile({ username, tag }); setMessage("Profilo aggiornato. · Profile updated. · Perfil actualizado."); }
    catch (error) { setMessage(`${(error as ApiError).message} · Update failed. · Actualización fallida.`); }
    finally { setBusy(false); }
  }
  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) { setMessage("La nuova password deve avere almeno 8 caratteri. · Password must be at least 8 characters. · La contraseña debe tener al menos 8 caracteres."); return; }
    setBusy(true);
    try { await api.changePassword({ current_password: currentPassword, new_password: newPassword }); setMessage("Password aggiornata. Gli altri dispositivi sono stati disconnessi. · Password updated; other devices signed out. · Contraseña actualizada; otros dispositivos desconectados."); setCurrentPassword(""); setNewPassword(""); await load(); }
    catch (error) { setMessage(`${(error as ApiError).message} · Password update failed. · No se pudo actualizar la contraseña.`); }
    finally { setBusy(false); }
  }

  const remaining = data?.credits?.total_remaining;
  const allowance = data?.usage?.credits_allowance ?? data?.plan?.credits_per_period;
  const used = data?.usage?.credits_used;
  return <main className="simple-page"><a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>From Zero To Hero</span></a><section className="simple-content account-section"><a className="back-link" href={preview ? "/account?preview=1" : "/account"}>← Torna alla panoramica · Back to overview · Volver al resumen</a><p className="eyebrow">{content.eyebrow}</p><h1>{content.title}</h1><p className="section-intro">{content.intro}</p>{message && <div className="inline-message" role="status">{message}</div>}{section === "profile" && <div className="section-layout"><form className="surface form-surface" onSubmit={saveProfile}><h2>Informazioni pubbliche · Public details · Datos públicos</h2><p>Questi dati ti accompagnano nelle piattaforme. · These details follow you across platforms. · Estos datos te acompañan en las plataformas.</p><label>Username<input value={username} onChange={e => setUsername(e.target.value)} /></label><label>Tag giocatore · Player tag · Tag de jugador<input value={tag} onChange={e => setTag(e.target.value)} placeholder="es. 1234" /></label><button className="button primary" disabled={busy}>{busy ? "Salvataggio… · Saving… · Guardando…" : "Salva modifiche · Save changes · Guardar cambios"}</button></form><article className="surface info-surface"><p className="eyebrow">ACCOUNT · CUENTA</p><h2>{user?.email ?? ""}</h2><p>L’email non viene mostrata pubblicamente. · Your email is never public. · Tu email nunca es público.</p><button className="danger-link" onClick={async () => { if (!window.confirm("Eliminare definitivamente l’account? Questa azione non può essere annullata. · Permanently delete the account? This cannot be undone. · ¿Eliminar la cuenta definitivamente? No se puede deshacer.")) return; await api.deleteAccount(); window.location.href = "/"; }}>Elimina account · Delete account · Eliminar cuenta</button></article></div>}{section === "subscription" && <div className="section-layout"><article className="surface info-surface"><p className="eyebrow">PIANO ATTUALE · CURRENT PLAN · PLAN ACTUAL</p><h2>{data?.plan?.name ?? "Free"}</h2><div className="progress-line"><span style={{ width: `${Math.min(100, data?.usage?.percent ?? 0)}%` }} /></div><p>{data?.usage?.percent ?? 0}% utilizzato · used · usado</p>{(remaining !== undefined || allowance !== undefined) && <div className="quota-detail"><strong>{remaining ?? "—"} crediti disponibili · credits remaining · créditos disponibles</strong><span>{used ?? "—"} utilizzati su {allowance ?? "—"} · used of · usados de</span></div>}{data?.usage?.overfilled && <div className="inline-message">Crediti bonus attivi · Bonus credits active · Créditos extra activos</div>}{data?.plan?.cancel_at_period_end && <div className="inline-message">Il piano resta attivo fino al termine del periodo. · Active until period end. · Activo hasta el final del periodo.</div>}{data?.plan?.active === false && <div className="inline-message">L’abbonamento è terminato. · Subscription ended. · La suscripción ha terminado.</div>}<a className="button primary" href={preview ? "/pricing?preview=1" : "/pricing"}>Vedi i piani · View plans · Ver planes</a></article><article className="surface info-surface"><p className="eyebrow">GESTIONE · MANAGEMENT · GESTIÓN</p><h2>Gestisci il tuo abbonamento</h2><p>Cambia piano, metodo di pagamento o annulla nel portale sicuro. · Change plan, payment method or cancel in the secure portal. · Cambia plan, pago o cancela en el portal seguro.</p><button className="button ghost" onClick={() => { if (preview) { setMessage("Modalità demo: portale Stripe disattivato. · Demo mode: Stripe portal disabled. · Modo demo: portal Stripe desactivado."); return; } void api.portal(window.location.origin + "/account/subscription").then(result => { window.location.href = result.url; }).catch(error => setMessage(`${(error as ApiError).message} · Portal unavailable. · Portal no disponible.`)); }}>Apri portale Stripe · Open Stripe portal · Abrir portal Stripe →</button></article></div>}{section === "security" && <div className="section-layout"><article className="surface form-surface"><h2>Cambia password · Change password · Cambiar contraseña</h2><form onSubmit={changePassword}><label>Password attuale · Current password · Contraseña actual<input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} /></label><label>Nuova password · New password · Nueva contraseña<input type="password" minLength={8} required value={newPassword} onChange={e => setNewPassword(e.target.value)} /></label><button className="button primary" disabled={busy}>Aggiorna · Update · Actualizar</button></form></article><article className="surface info-surface"><h2>I tuoi dispositivi · Your devices · Tus dispositivos</h2>{(data?.sessions ?? []).map((session: any) => <div className="device-row" key={session.id}><span className="device-icon">{session.current ? "●" : "○"}</span><div><strong>{session.current ? "Questo dispositivo · This device · Este dispositivo" : session.service ?? "Altro dispositivo · Other device · Otro dispositivo"}</strong><small>{session.user_agent ?? "Sessione attiva · Active session · Sesión activa"}</small></div>{!session.current && <button className="text-button" onClick={() => api.revokeSession(session.id).then(load).catch(error => setMessage(`${(error as ApiError).message} · Sign-out failed. · Desconexión fallida.`))}>Disconnetti · Sign out · Desconectar</button>}</div>)}<button className="danger-link" onClick={async () => { await api.logoutAll(); window.location.href = "/login"; }}>Disconnetti gli altri · Sign out others · Desconectar los demás</button></article></div>}{section === "transactions" && <article className="surface transaction-surface">{(data?.transactions ?? []).length ? (data.transactions as any[]).map(transaction => <div className="transaction-row" key={transaction.id}><div><strong>{transaction.description}</strong><small>{transaction.timestamp ? new Date(transaction.timestamp).toLocaleString("it-IT") : ""}</small></div><b className={transaction.amount > 0 ? "positive" : "negative"}>{transaction.amount > 0 ? "+" : ""}{transaction.amount}</b></div>) : <div className="empty-state"><span>✦</span><p>Nessuna attività. · No activity yet. · Aún no hay actividad.</p></div>}</article>}</section></main>;
}
