import Image from "next/image";

const platforms = [
  { name: "eFootball", text: "Carte, build, rosa e match. Tutto sul tuo gioco.", status: "Disponibile ora" },
  { name: "Arena Tornei", text: "Community, sfide e tornei in un unico spazio.", status: "Disponibile ora" },
  { name: "League of Legends", text: "Coming soon. Ora domina eFootball.", status: "Coming Soon" }
];

const benefits = ["Carte", "Build", "Rosa", "Match", "Coach"];
const plans = [
  { name: "Lite", price: "€ 7,99", items: ["Accesso alle funzionalità base", "Analisi e consigli AI", "Supporto via email"] },
  { name: "Pro", price: "€ 14,99", items: ["Tutte le funzionalità", "Analisi avanzate", "Accesso all’Arena Tornei", "Supporto prioritario"], featured: true },
  { name: "Ultra", price: "€ 29,99", items: ["Esperienza completa", "Funzionalità esclusive", "Accesso anticipato alle novità", "Supporto dedicato"] }
];

export default function Home() {
  return <main className="site-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="From Zero To Hero home"><Image src="/logo.webp" alt="From Zero To Hero" width={44} height={44} /><span>From Zero To Hero</span></a>
      <nav className="nav" aria-label="Navigazione principale"><a href="#platforms">Piattaforme</a><a href="#how">Come funziona</a><a href="#pricing">Prezzi</a><a href="#faq">FAQ</a></nav>
      <div className="nav-actions"><a className="button ghost" href="/login">Accedi</a><a className="button primary" href="/register">Inizia ora <span aria-hidden>→</span></a></div>
    </header>
    <section className="hero" id="top">
      <div><div className="eyebrow">AI PERFORMANCE COACH</div><h1>La prima piattaforma di <em>coach AI multigioco.</em></h1><p className="hero-copy">Accedi alla piattaforma, scegli il gioco e attiva il coach AI: risultati più rapidi, miglioramenti immediati e meccaniche nascoste finalmente chiare.</p><div className="steps"><span className="step"><b>01</b>Accedi</span><span className="step"><b>02</b>Scegli il gioco</span><span className="step"><b>03</b>Migliora</span></div><div className="hero-actions"><a className="button primary" href="/login">Accedi alla piattaforma <span aria-hidden>→</span></a><a className="button ghost" href="#how">▷ &nbsp;Scopri come funziona</a></div></div>
      <div className="hero-visual" aria-label="Anteprima della piattaforma eFootball"><article className="coach-card"><div className="pill">✦ AI COACH</div><h2>eFootball</h2><p>Il tuo gioco. Letto meglio.</p>{["Analisi rosa", "Tattiche e moduli", "Consigli mercato", "Analisi match"].map((item) => <div className="coach-row" key={item}><span>✦</span>{item}</div>)}</article></div>
    </section>
    <section className="section" id="platforms"><div className="section-header"><div><h2>Scegli il tuo gioco</h2><p>eFootball ora, League in arrivo.</p></div><a href="/platforms">Vedi tutte le piattaforme →</a></div><div className="platform-grid">{platforms.map((platform) => <article className="platform-card" key={platform.name}><header><h3>{platform.name}</h3><span className={`pill ${platform.status === "Coming Soon" ? "soon" : ""}`}>{platform.status}</span></header><p>{platform.text}</p></article>)}</div></section>
    <section className="section" id="how"><div className="benefits">{benefits.map((benefit, index) => <div className="benefit" key={benefit}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{benefit}</strong><br /><small>{index === 0 ? "spendi solo se serve" : index === 1 ? "fatta per il tuo stile" : index === 2 ? "niente ruoli scoperti" : index === 3 ? "capisci dove perdi campo" : "decisioni pratiche"}</small></span></div>)}</div></section>
    <section className="section" id="pricing"><div className="section-header"><div><h2>Scegli il piano giusto</h2><p>Più valore al tuo gioco. Un unico ecosistema.</p></div><a className="button primary" href="/pricing">Scegli il piano →</a></div><div className="plans">{plans.map((plan) => <article className={`plan-card ${plan.featured ? "featured" : ""}`} key={plan.name}><h3>{plan.name}</h3><strong>{plan.price}<small> / mese</small></strong><ul>{plan.items.map((item) => <li key={item}>✓ &nbsp;{item}</li>)}</ul></article>)}</div></section>
    <section className="cta-band" id="faq"><h2>Non copiare. <em>Domina.</em></h2><p>Carica. Analizza. Vinci. Il tuo coach parte dalla tua rosa.</p><a className="button primary" href="/register">Accedi alla piattaforma →</a></section>
    <footer className="footer"><a className="brand" href="#top"><Image src="/logo.webp" alt="" width={32} height={32} /><span>FROM ZERO TO HERO</span></a><span>Chi siamo　 Lavora con noi　 Termini　 Privacy</span><span>Una piattaforma indipendente per giocatori che vogliono migliorare.</span></footer>
  </main>;
}
