# From Zero To Hero — metalgate-refactoring

Scaffold originale per il nuovo gateway frontend From Zero To Hero. Il mockup landing è responsive e usa il logo ufficiale `public/logo.webp`.

## Avvio

```bash
npm install
copy .env.example .env.local
npm run dev
```

La base API è configurabile con `NEXT_PUBLIC_API_URL`. Le chiamate browser passano dal client in `src/lib/api.ts`, usano `credentials: "include"` e non persistono token. Il backend resta la source of truth; questa preview non contiene un backend alternativo né credenziali reali.

## Verifica

```bash
npm run typecheck
npm run build
```
