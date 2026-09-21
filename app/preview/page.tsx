import Link from "next/link";

const publicPages = [
  ["Home", "/"], ["Piattaforme", "/platforms"], ["Prezzi", "/pricing"], ["Login", "/login"], ["Registrazione", "/register"], ["Recupero password", "/forgot-password"], ["Codice reset", "/verify-code"], ["Nuova password", "/reset-password"], ["Verifica email", "/verify-email"]
];
const accountPages = [["Panoramica", "/account"], ["Profilo", "/account/profile"], ["Abbonamento", "/account/subscription"], ["Sicurezza", "/account/security"], ["Attività", "/account/transactions"]];

export default function PreviewIndex() {
  return <main className="simple-page preview-index"><a className="brand" href="/"><img src="/logo.webp" alt="From Zero To Hero" /><span>From Zero To Hero</span></a><section className="simple-content"><p className="eyebrow">LOCAL PREVIEW</p><h1>Esplora tutto il prodotto.</h1><p>Questa area serve solo per vedere il percorso completo senza autenticazione. Funziona su localhost e non modifica la sicurezza della produzione.</p><div className="preview-groups"><div><p className="eyebrow">PAGINE PUBBLICHE</p><nav className="preview-links">{publicPages.map(([label, href]) => <Link className="preview-link" href={href} key={href}>{label}<span aria-hidden>→</span></Link>)}</nav></div><div><p className="eyebrow">AREA ACCOUNT DEMO</p><nav className="preview-links">{accountPages.map(([label, href]) => <Link className="preview-link" href={`${href}${href.includes("?") ? "&" : "?"}preview=1`} key={href}>{label}<span aria-hidden>↗</span></Link>)}</nav></div></div><p className="field-hint">Avvia con <code>npm run dev</code> e apri <code>/preview</code>.</p></section></main>;
}
