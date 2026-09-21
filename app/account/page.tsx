"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/src/lib/api";

type LoadState = "loading" | "ready" | "error";
type AccountData = { session: any; me: any; credits: any; transactions: any[]; sessions: any[] };

const navigation = [
  { href: "/account", label: "Panoramica", icon: "⌂" },
  { href: "/platforms", label: "Piattaforme", icon: "◈" },
  { href: "/account/profile", label: "Profilo", icon: "◯" },
  { href: "/account/subscription", label: "Abbonamento", icon: "✦" },
  { href: "/account/security", label: "Sicurezza", icon: "◇" },
  { href: "/account/transactions", label: "Attività", icon: "↗" }
];

function initials(user: any) { return (user?.username || user?.email || "U").slice(0, 2).toUpperCase(); }

function LoadingWorkspace() {
  return <div className="workspace-loading" aria-label="Caricamento area personale"><span /><span /><span /><div /></div>;
}

function FirstRunGuide({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);
  const steps = [
    { eyebrow: "01 · IDENTITÀ", title: "Diamo un nome al tuo percorso.", body: "Completa il profilo: servirà per ritrovarti in ogni piattaforma.", action: "Apri il profilo", href: "/account/profile" },
    { eyebrow: "02 · IL TUO GIOCO", title: "Da dove vuoi iniziare?", body: "eFootball è disponibile ora. Le prossime piattaforme si aggiungeranno al tuo account.", action: "Scopri eFootball", href: "/platforms" },
    { eyebrow: "03 · PRONTO A PARTIRE", title: "Il tuo spazio è pronto.", body: "Quando vorrai, il tuo piano e il tuo utilizzo saranno sempre qui, chiari e sotto controllo.", action: "Vai alla piattaforma", href: "/platforms" }
  ];
  const current = steps[step];
  return <section className="onboarding-card" aria-labelledby="onboarding-title"><div className="onboarding-orbit" aria-hidden><span>↗</span></div><div className="onboarding-content"><p className="eyebrow">{current.eyebrow}</p><h2 id="onboarding-title">{current.title}</h2><p>{current.body}</p><div className="onboarding-actions"><a className="button primary" href={current.href} onClick={() => { if (step === steps.length - 1) onComplete(); }}>{current.action} <span aria-hidden>→</span></a>{step < steps.length - 1 ? <button className="text-button" onClick={() => setStep((value) => value + 1)}>Continua <span aria-hidden>→</span></button> : <button className="text-button" onClick={onComplete}>Nascondi guida</button>}</div><div className="onboarding-dots" aria-label={`Passo ${step + 1} di ${steps.length}`}>{steps.map((_, index) => <button key={index} aria-label={`Vai al passo ${index + 1}`} className={index === step ? "active" : ""} onClick={() => setStep(index)} />)}</div></div></section>;
}

function Workspace({ data }: { data: AccountData }) {
  const [showGuide, setShowGuide] = useState(!data.me?.username || !data.me?.tag);
  const plan = data.credits?.plan;
  const usage = data.credits?.usage;
  const percent = typeof usage?.percent === "number" ? Math.min(100, Math.max(0, usage.percent)) : 0;
  const displayName = data.session?.username || data.session?.email?.split("@")[0] || "giocatore";
  const visibleTransactions = useMemo(() => data.transactions.slice(0, 4), [data.transactions]);
  return <div className="workspace"><aside className="workspace-sidebar"><a className="workspace-brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>FROM ZERO<br /><b>TO HERO</b></span></a><div className="workspace-profile"><div className="avatar">{initials(data.session)}</div><div><strong>{displayName}</strong><small>{data.session?.email}</small></div></div><nav className="workspace-nav" aria-label="Area personale">{navigation.map((item) => <a className={item.href === "/account" ? "selected" : ""} href={item.href} key={item.href}><span>{item.icon}</span>{item.label}</a>)}</nav><div className="sidebar-footer"><a href="/legal/privacy">Privacy</a><a href="/legal/terms">Termini</a><button onClick={async () => { await api.logout(); window.location.href = "/"; }}>Esci</button></div></aside><main className="workspace-main"><header className="workspace-topbar"><div><p className="eyebrow">IL TUO SPAZIO</p><h1>Bentornato, {displayName}.</h1></div><div className="topbar-actions"><button className="icon-button" aria-label="Notifiche">♧</button><a className="avatar small" href="/account/profile">{initials(data.session)}</a></div></header><section className="workspace-intro"><div><p>Un punto di partenza chiaro per tutto quello che vuoi migliorare.</p><a className="button primary" href="/platforms">Vai alle piattaforme <span aria-hidden>→</span></a></div><div className="intro-mark" aria-hidden><span>FZ</span><i /></div></section>{showGuide && <FirstRunGuide onComplete={() => setShowGuide(false)} />}<section className="workspace-grid"><article className="surface platform-focus"><div className="surface-heading"><div><p className="eyebrow">IN EVIDENZA</p><h2>eFootball</h2></div><span className="status-chip live"><i /> Disponibile ora</span></div><p className="surface-copy">Il tuo spazio per carte, build, rosa e partite. Entra quando vuoi riprendere il filo.</p><div className="platform-focus-footer"><div className="focus-stats"><span><b>01</b> Carte</span><span><b>02</b> Build</span><span><b>03</b> Rosa</span></div><a className="button dark" href="/platforms">Apri piattaforma <span aria-hidden>↗</span></a></div></article><article className="surface usage-surface"><div className="surface-heading"><div><p className="eyebrow">IL TUO PIANO</p><h2>{plan?.name ?? "Free"}</h2></div><a className="quiet-link" href="/account/subscription">Gestisci →</a></div><div className="usage-ring" style={{ "--usage": `${percent * 3.6}deg` } as React.CSSProperties}><div><strong>{Math.round(percent)}%</strong><small>utilizzato</small></div></div><p className="usage-note">{usage?.overfilled ? "Stai usando i crediti bonus." : plan?.cancel_at_period_end ? `Attivo fino al ${new Date(plan.current_period_end).toLocaleDateString("it-IT")}.` : plan?.active === false ? "Il tuo abbonamento è terminato." : "Il tuo periodo è in corso."}</p>{data.credits?.upgrade?.show && <a className="upgrade-link" href={data.credits.upgrade.url}>{data.credits.upgrade.cta_label} <span aria-hidden>→</span></a>}</article></section><section className="workspace-grid lower"><article className="surface activity-surface"><div className="surface-heading"><div><p className="eyebrow">ULTIME ATTIVITÀ</p><h2>Il tuo percorso</h2></div><a className="quiet-link" href="/account/transactions">Vedi tutto →</a></div>{visibleTransactions.length ? <div className="activity-list">{visibleTransactions.map((tx: any) => <div className="activity-row" key={tx.id}><div className="activity-icon">{tx.amount > 0 ? "+" : "↗"}</div><div><strong>{tx.description}</strong><small>{tx.timestamp ? new Date(tx.timestamp).toLocaleDateString("it-IT") : "Operazione recente"}</small></div><b className={tx.amount > 0 ? "positive" : ""}>{tx.amount > 0 ? "+" : ""}{tx.amount}</b></div>)}</div> : <div className="empty-state"><span>✦</span><p>Le tue attività compariranno qui quando inizierai il percorso.</p></div>}</article><article className="surface next-surface"><p className="eyebrow">PROSSIMO PASSO</p><h2>Rendi il tuo account tuo.</h2><p>Aggiungi username e tag per entrare nelle piattaforme con un’identità riconoscibile.</p><a className="quiet-link" href="/account/profile">Completa il profilo <span aria-hidden>→</span></a></article></section><footer className="workspace-mobile-nav">{navigation.slice(0, 4).map(item => <a className={item.href === "/account" ? "selected" : ""} href={item.href} key={item.href}><span>{item.icon}</span>{item.label}</a>)}</footer></main></div>;
}

export default function AccountPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [data, setData] = useState<AccountData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => { setState("loading"); setError(""); try { const [session, me, credits, transactionsResponse, sessionsResponse] = await Promise.all([api.session(), api.me(), api.credits(), api.transactions(), api.authSessions()]); const transactions = transactionsResponse as any; const sessions = sessionsResponse as any; setData({ session, me, credits, transactions: transactions?.transactions ?? [], sessions: sessions?.sessions ?? [] }); setState("ready"); } catch (caught) { const e = caught as ApiError; if (e.status === 401) { window.location.href = "/login?return_to=/account"; return; } setError(e.message); setState("error"); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (state === "loading") return <main className="account-loading"><img src="/logo.webp" alt="From Zero To Hero" /><LoadingWorkspace /></main>;
  if (state === "error" || !data) return <main className="account-error"><img src="/logo.webp" alt="From Zero To Hero" /><div className="error-panel"><p className="eyebrow">IL TUO SPAZIO È QUI</p><h1>Non riesco a caricare i dati.</h1><p>{error || "Controlla la connessione e riprova."}</p><button className="button primary" onClick={() => void load()}>Riprova</button><a href="/">Torna alla home</a></div></main>;
  return <Workspace data={data} />;
}
