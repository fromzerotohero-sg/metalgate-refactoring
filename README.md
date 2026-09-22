# From Zero To Hero — metalgate-refactoring

Gateway frontend dell'ecosistema From Zero To Hero (Next.js 15, App Router), allineato al backend **SilverGate** (`api-for-frontend.it.md`).

## Avvio

```bash
npm install
copy .env.example .env.local
npm run dev
```

La base API è configurabile con `NEXT_PUBLIC_API_URL`. Le chiamate browser passano dal client in `src/lib/api.ts`, usano `credentials: "include"` (cookie di sessione HttpOnly) e non persistono token. Il backend resta la source of truth.

## Anteprima locale senza login

Apri `http://localhost:3000/preview`: elenca tutte le pagine. Le pagine protette si aprono con `?preview=1` e dati mock (`src/lib/preview.ts`), solo su localhost.

## Internazionalizzazione

IT (default) / EN / ES con switcher nell'header. Dizionari in `src/lib/i18n.tsx`, lingua persistita in `localStorage`.

## Struttura

- `src/lib/api.ts` — client API SilverGate tipizzato
- `src/lib/i18n.tsx` — provider + dizionari
- `src/lib/legal.tsx` — testi legali completi (Termini / Privacy, IT·EN·ES)
- `src/lib/preview.ts` — dati demo locali
- `src/components/` — `SiteHeader`, `SiteFooter`, `LanguageSwitcher`, `Grids` (card piattaforme/piani)
- `app/` — home, login, register, recovery, verify-email, pricing, platforms, account (+ sezioni), legal, preview

## Verifica

```bash
npm run typecheck
npm run build
```
