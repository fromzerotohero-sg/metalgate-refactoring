# From Zero To Hero — silvergate-frontend

Gateway frontend dell'ecosistema From Zero To Hero (Next.js 15, App Router), allineato al backend **SilverGate**.

## Avvio

```bash
npm install
cp .env.example .env.local
npm run dev
```

La base API è configurabile con `NEXT_PUBLIC_API_URL`. Le chiamate browser passano dal client in `src/lib/api.ts`, usano `credentials: "include"` (cookie di sessione HttpOnly) e non persistono token. Il backend resta la source of truth.

## Verifica

```bash
npm run typecheck
npm run build
```

## Il contratto API

`api-for-frontend.md` / `api-for-frontend.it.md` in questa cartella sono **copie** di
`docs/api-for-frontend.md` / `.it.md` alla radice del progetto. Quelle alla radice sono
la fonte: non modificarle qui, e non lasciarle divergere — una copia vecchia fa
implementare l'endpoint sbagliato.

## Sicurezza

Il cookie di sessione è condiviso da **tutte** le piattaforme del brand
(`.fromzerotohero.io`): uno script iniettato in una qualunque di esse agisce a nome
dell'utente su tutte. Per questo il controllo più importante di questo deployment è la
Content-Security-Policy.

- **`middleware.ts`** genera un nonce per richiesta e imposta la CSP con `script-src
  'nonce-…' 'strict-dynamic'`. Un nonce (e non `'unsafe-inline'`) è l'unica forma che
  blocca davvero uno script inline iniettato.
- **`app/layout.tsx`** legge gli header della richiesta: è ciò che lega il nonce agli
  script di Next e rende ogni route dinamica. In `next build` tutte le route
  risulteranno `ƒ (Dynamic)`: è voluto, una pagina prerenderizzata porterebbe un nonce
  vecchio.
- **`next.config.mjs`** imposta HSTS (l'header dell'API copre solo `api.…`; HSTS è
  host-scoped, quindi l'apex ha bisogno del suo), `X-Content-Type-Options`,
  `Referrer-Policy: no-referrer` (`/verify-email` porta un token nella query string),
  `X-Frame-Options` e `Permissions-Policy`.

**La CSP va provata a mano prima del deploy**: `npm run build && npm start`, poi
aprire la home, `/login`, `/verify-email` e `/account` guardando la console del browser
per violazioni. Con `'strict-dynamic'` la posta è alta: se Next non riuscisse ad
applicare il nonce, tutto il JavaScript verrebbe bloccato e le pagine resterebbero
senza interattività (l'HTML server-rendered si vedrebbe comunque, quindi non è un
white screen).

**Piano B, in un minuto.** Cancellare `middleware.ts` e aggiungere alla CSP in
`headers()` di `next.config.mjs`:

```
{
  key: "Content-Security-Policy",
  value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.fromzerotohero.io; form-action 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'; upgrade-insecure-requests"
}
```

È una policy più debole (`'unsafe-inline'` non ferma uno script inline iniettato) ma
funziona di sicuro: usala come ponte, non come destinazione.

## Rotte

Oltre alle pagine, `/dashboard` esiste come alias di `/account`: il backend invia lì
l'utente dopo la verifica dell'email (quando il link non porta un `redirect`) e al
ritorno dal portale Stripe. `SG_DASHBOARD_URL` punta a `/account`, ma l'alias fa
funzionare entrambi i valori.

## Anteprima locale senza login

Apri `http://localhost:3000/preview`: elenca tutte le pagine. Le pagine protette si aprono con `?preview=1` e dati mock (`src/lib/preview.ts`), **solo su localhost** — in produzione `isLocalPreview()` è sempre falso, quindi `?preview=1` non attiva nulla.

## Flusso di autenticazione

1. `POST /api/register` → email con un link che punta a `/verify-email` di questo frontend.
2. `/verify-email` legge `token` e `redirect`, chiama `POST /api/sso/verify-email` e riceve
   il cookie di sessione: l'utente è dentro senza aver mai fatto login.
3. Da lì in poi `/api/session` risponde 200 su ogni piattaforma del brand. Non esiste
   scadenza: si esce solo con `POST /api/auth/logout` (o revocando la sessione dai dispositivi).

## Internazionalizzazione

IT (default) / EN / ES con switcher nell'header. Dizionari in `src/lib/i18n.tsx`, lingua persistita in `localStorage` (l'unica cosa che questo frontend salva nel browser).

## Struttura

- `src/lib/api.ts` — client API SilverGate tipizzato
- `src/lib/i18n.tsx` — provider + dizionari
- `src/lib/legal.tsx` — testi legali completi (Termini / Privacy, IT·EN·ES)
- `src/lib/preview.ts` — dati demo locali
- `src/components/` — `SiteHeader`, `SiteFooter`, `LanguageSwitcher`, `Icon`, `Grids` (card piattaforme/piani), `StoreBadges` (badge App Store / Google Play: segnaposto, mostrano "Presto disponibile" finché le app non esistono)
- `middleware.ts` — CSP con nonce
- `app/` — home, login, register, recovery, verify-email, pricing, platforms, account (+ sezioni), dashboard (alias), legal, preview
