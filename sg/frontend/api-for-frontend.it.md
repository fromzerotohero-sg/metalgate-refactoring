# SilverGate — Guida API per sviluppatori frontend

**Stato: bozza.** Il backend in `sg/` è scritto e revisionato ma **non è ancora stato
eseguito** e le sue migrazioni non sono state applicate. Consideralo una specifica
fino al primo deploy riuscito.

Versione inglese: [`api-for-frontend.md`](./api-for-frontend.md)

---

## 1. Leggi prima questo: l'autenticazione è un cookie, non un token

Questa è la differenza più grande rispetto al vecchio frontend, e sbagliarla
romperà tutto il resto.

SilverGate mantiene l'utente autenticato con **un unico token di sessione opaco in un
cookie `HttpOnly`**. Questo significa:

- **JavaScript non può leggere il token.** È `HttpOnly` di proposito — è ciò che
  impedisce a un bug XSS su qualsiasi piattaforma di rubare una credenziale che non
  scade mai.
- **Non c'è nulla da mettere in `localStorage`.** Il vecchio `metalgate_token` non
  esiste più. Non memorizzare token, non leggere `document.cookie`, non inviare un
  header `Authorization` dal browser.
- **Ogni richiesta deve inviare il cookie**, quindi ogni `fetch` richiede
  `credentials: 'include'`.
- **Per sapere se l'utente è autenticato, chiedilo al server:**
  `GET /api/session` restituisce `200` + l'utente, oppure `401`.

Il vantaggio: il cookie è limitato all'intero dominio del brand, quindi un utente che
effettua l'accesso una volta su una qualsiasi piattaforma è autenticato su tutte, e la
sessione non scade finché non effettua il logout.

### L'unica regola valida per ogni pagina

```js
// Esegui questo al caricamento della pagina, prima di renderizzare qualsiasi cosa che dipenda dall'autenticazione.
const res = await fetch(`${API}/session`, { credentials: 'include' });

if (res.status === 200) {
  const user = await res.json();   // autenticato
} else {
  // 401 — non autenticato. Mostra il link di Login. NON mostrare una pagina rotta.
}
```

**Non mostrare mai il form di login senza prima averlo chiesto.** Se `/api/session`
restituisce 200, il visitatore è già autenticato e deve essere reindirizzato
direttamente. Mostrare un form di login a un utente autenticato è il bug che aveva il
vecchio `login.html`.

---

## 2. URL di base e ambiente

| | |
|---|---|
| Produzione | `https://v2.fromzerotohero.io/api` |
| Sviluppo locale | `http://localhost:4001/api` (vedi §11) |

Tutti i percorsi seguenti sono relativi a quella base. Quindi `GET /api/session`
significa `GET https://v2.fromzerotohero.io/api/session`.

Il frontend è servito da `https://silver.fromzerotohero.io` e l'API da
`https://v2.fromzerotohero.io` — lo stesso dominio registrabile. Il browser parla
solo con il frontend, che fa da proxy per `/api/*` verso l'API, quindi il cookie di
sessione resta first-party: le chiamate sono same-site e non serve alcun handshake
di redirect. È questo che fa funzionare il login condiviso. (`silver.` è un hostname
temporaneo per il frontend; `v2.` è quello definitivo dell'API — se il frontend
cambia nome, cambia solo l'ambiente del frontend.)

---

## 3. Convenzioni che ogni richiesta deve rispettare

| Convenzione | Perché |
|---|---|
| `credentials: 'include'` su **ogni** chiamata | Altrimenti il browser non invierà né accetterà il cookie di sessione |
| `Content-Type: application/json` sulle richieste con un body | L'API analizza JSON; la maggior parte degli endpoint rifiuta i body non JSON |
| La tua origin deve essere tra le `SG_CORS_ORIGINS` del server | Le richieste che portano il cookie da un origin non in elenco ricevono `403 {"error": "Origin not allowed"}` |
| Non ritentare un `401`/`403` in un ciclo | Non sono transitori |

### Forma degli errori

Ogni errore è JSON con una chiave `error`, più dettagli opzionali:

```json
{ "error": "Email and password are required" }
```

Un caso specifico porta campi aggiuntivi, e il frontend deve gestirlo:

```json
{
  "error": "Email not verified",
  "message": "Please verify your email before logging in",
  "requires_verification": true
}
```

### Codici di stato

| Codice | Significato |
|---|---|
| 200 | Successo |
| 400 | La richiesta è sbagliata (campi mancanti/non validi, piano sconosciuto…) |
| 401 | Non autenticato, credenziali errate o token non valido |
| 403 | Autenticato ma non autorizzato — un'email non verificata, o un `Origin` non in elenco |
| 404 | Non trovato (utente sconosciuto, sessione sconosciuta) |
| 410 | **Endpoint dismesso** — vedi il messaggio, ti dice dove è stato spostato |
| 429 | Rate limit. `{"error": "Too many requests…", "limit": "10 per 1 minute"}` |
| 500 | Guasto del server |
| 503 | Una dipendenza non è configurata (es. la fatturazione) |

I rate limit sono per indirizzo IP e si applicano all'intero endpoint, non per utente.

---

## 4. Sessione e autenticazione

### `GET /api/session`
Alias: `/api/auth/session`

La sonda d'identità del frontend. Chiamala a ogni caricamento di pagina e dopo ogni
redirect.

**200** — autenticato:

```json
{
  "id": "8f1c…",
  "email": "user@example.com",
  "username": "mario",
  "tag": "1234",
  "credits": 142,
  "email_verified": true
}
```

**401** — `{"error": "Unauthorized"}` — non autenticato.

> `credits` qui è il saldo grezzo del piano. **Non mostrarlo agli utenti.** Renderizza
> invece la barra di avanzamento da `/api/credits` (§6).

### `POST /api/auth/login`
Alias: `/api/login`, `/api/sso/login`

```json
{ "email": "user@example.com", "password": "…", "service": "web" }
```

`service` è opzionale; invia l'id della tua piattaforma (es. `"efootball"`) così la
telemetria di login registra da dove proviene l'utente.

**200** — imposta il cookie di sessione e restituisce:

```json
{
  "message": "Login successful",
  "token": "<short-lived access token>",
  "user": { "id": "…", "email": "…", "username": "…", "tag": "…",
            "credits": 142, "email_verified": true }
}
```

> **Ignora `token`.** È una credenziale di 10 minuti per i *server delle piattaforme*,
> non per i browser. È il cookie che autentica l'utente. Memorizzare questo token è
> esattamente l'errore che questa architettura elimina.

**403** — email non verificata; vedi la forma `requires_verification` nel §3. Offri
l'azione "reinvia email di verifica".

**401** — `{"error": "Invalid credentials"}`.

**400** — email o password mancanti.

### `POST /api/auth/logout`
Alias: `/api/logout`

Nessun body. Cancella il cookie e revoca la sessione ovunque. Idempotente — sicuro da
chiamare quando si è già disconnessi. Restituisce `{"message": "Logged out successfully"}`.

### `POST /api/auth/logout-all`

Disconnette l'utente da **ogni** dispositivo e piattaforma. Restituisce
`{"message": "Logged out of all devices", "sessions_revoked": 3}`.

### `GET /api/auth/sessions`

Per un pannello "i tuoi dispositivi".

```json
{ "sessions": [
  { "id": "…", "current": true, "created_at": "2026-09-17T09:00:00+00:00",
    "last_seen_at": "2026-09-17T18:22:00+00:00", "ip": "203.0.113.7",
    "user_agent": "Mozilla/5.0 …", "service": "web" }
] }
```

### `DELETE /api/auth/sessions/<session_id>`

Disconnette un altro dispositivo. `404` se non è tuo o è già stato revocato.

### `POST /api/auth/change-password`

```json
{ "current_password": "…", "new_password": "…" }
```

Minimo 8 caratteri. **Ogni altra sessione viene revocata** in caso di successo, quindi
l'utente resta autenticato solo sul dispositivo che sta usando. Restituisce
`{"message": "Password updated. Other devices have been signed out."}`.

`401` se `current_password` è sbagliata.

---

## 5. Profilo e account

### `GET /api/me`

Il profilo completo. Usalo per la dashboard; usa `/api/session` per un controllo
d'identità leggero.

```json
{
  "id": "8f1c…",
  "email": "user@example.com",
  "username": "mario",
  "tag": "1234",
  "credits": 142,
  "temp_credits": 25,
  "temp_credits_grants": [ { "amount": 25, "expires_at": "2026-10-01T00:00:00+00:00" } ],
  "temp_credits_next_expiry": "2026-10-01T00:00:00+00:00",
  "plan": { … },
  "usage": { … },
  "upgrade": { … },
  "referral_code": "aB3xY9zQ",
  "referral_count": 2,
  "referral_bonus_credits": 50,
  "referral_earnings": 100,
  "created_at": "2026-01-04T12:00:00+00:00"
}
```

I campi dei crediti sono numeri grezzi e **non** sono destinati alla visualizzazione
per l'utente finale. Esistono per la piattaforma di amministrazione e per il debug.

`plan`, `usage` e `upgrade` contengono gli stessi oggetti documentati nel §6; `plan` e
`upgrade` possono essere `null`.

### `PUT /api/profile`

```json
{ "username": "mario", "tag": "1234" }
```

Invia solo ciò che è cambiato. `400` se non invii nessuno dei due. Restituisce
`{"message": "Profile updated", "user": {…}}` dove `user` ha la forma di
`/api/session`.

### `DELETE /api/me`

Elimina l'account in modo permanente e revoca ogni sessione. Restituisce
`{"message": "Account deleted successfully"}`. **Chiedi una conferma esplicita** —
non c'è annullamento né soft-delete.

### `GET /api/transactions`

Le 50 voci più recenti, dalla più nuova.

```json
{ "transactions": [
  { "id": "…", "amount": -12, "type": "deduction",
    "description": "Coaching session analysis",
    "status": "completed", "timestamp": "2026-09-16T20:11:00+00:00" }
] }
```

`amount` è negativo per una spesa e positivo per un accredito. `type` può essere:

| `type` | Significato |
|---|---|
| `subscription_grant` | L'allowance del piano concessa per un nuovo periodo di fatturazione |
| `purchase` | Pacchetti di crediti una tantum, precedenti agli abbonamenti (dismessi) |
| `bonus` | Un credito temporaneo concesso (referral, admin, promozione) |
| `deduction` | Crediti spesi da una piattaforma |

Vengono restituite solo le 50 voci più recenti e non c'è ancora paginazione: se
l'interfaccia ha bisogno della cronologia completa, va prima aggiunta lato server.

---

## 6. Piani, utilizzo e la barra di avanzamento

### `GET /api/credits`
Alias: `/api/credits/`, `/api/plan/usage`

**Questo è l'endpoint che sostituisce la visualizzazione del conteggio dei crediti
agli utenti.** Restituisce una percentuale di utilizzo per una barra di avanzamento,
il piano corrente e la call to action per l'upgrade.

```json
{
  "plan": {
    "id": "pro", "name": "Pro", "credits_per_period": 300,
    "price_cents": 1499, "currency": "EUR", "price_display": "€14.99",
    "interval": "month", "active": true, "status": "active",
    "current_period_start": "2026-09-17T09:00:00+00:00",
    "current_period_end": "2026-10-17T09:00:00+00:00",
    "cancel_at_period_end": false
  },
  "usage": {
    "percent": 73.3,
    "overfilled": false,
    "credits_used": 220,
    "credits_allowance": 300
  },
  "credits": {
    "plan_remaining": 80,
    "temporary_remaining": 25,
    "total_remaining": 105,
    "temporary_grants": [ … ],
    "temporary_next_expiry": "2026-10-01T00:00:00+00:00"
  },
  "upgrade": {
    "show": true,
    "reason": "within_threshold",
    "threshold_percent": 90,
    "next_plan": { "id": "ultra", "name": "Ultra", "credits_per_period": 750,
                   "price_display": "€29.99", "interval": "month" },
    "cta_label": "Upgrade to Ultra to have higher limits",
    "url": "https://silver.fromzerotohero.io/pricing"
  }
}
```

**Come renderizzarlo**

- **La barra** è `usage.percent`, da 0 a 100. Quando `usage.overfilled` è `true`
  l'utente ha speso tutta la quota del piano e sta usando i crediti temporanei —
  mostra la barra piena e contrassegnala come "crediti bonus", non limitarla in
  silenzio.
- **`plan` può essere `null`** (mai abbonato). Gestiscilo: mostra lo stato gratuito e
  l'upsell, non un errore.
- **`plan.active === false`** significa che l'abbonamento è scaduto o è stato
  annullato. Mostra "il tuo abbonamento è terminato" più una CTA per riabbonarsi.
- **`plan.cancel_at_period_end === true`** significa che è annullato ma ancora attivo
  fino a `current_period_end`. Dillo.
- **`upgrade` può essere `null`** — mostra la CTA solo quando è presente. Il link è
  `upgrade.url`, ed è il backend a deciderlo.

  **`upgrade.cta_label` è solo in inglese.** L'API non ha un concetto di lingua e usa la
  stessa frase per entrambi i valori di `reason`, variando solo il nome del piano. Un'app
  tradotta deve quindi costruirsi il testo da sola dal nome del piano — per esempio una
  stringa `cta.upgrade` pari a `"Passa a {plan} per limiti più alti"` per ogni lingua,
  con `{plan}` sostituito da `upgrade.next_plan.name` — e tenere `cta_label` solo come
  fallback. Renderizzare `cta_label` alla lettera è ciò che mette un pulsante in inglese
  in mezzo a una pagina tradotta.
- **Ignora il blocco `credits` per la visualizzazione all'utente.**

### `GET /api/plans`

Pubblico — la pagina dei prezzi può chiamarlo prima del login.

```json
{ "plans": [
  { "id": "lite",  "name": "Lite",  "credits_per_period": 150,
    "price_cents": 799,  "currency": "EUR", "price_display": "€7.99",  "interval": "month" },
  { "id": "pro",   "name": "Pro",   "credits_per_period": 300,
    "price_cents": 1499, "currency": "EUR", "price_display": "€14.99", "interval": "month" },
  { "id": "ultra", "name": "Ultra", "credits_per_period": 750,
    "price_cents": 2999, "currency": "EUR", "price_display": "€29.99", "interval": "month" }
] }
```

I piani sono mensili e **i crediti non utilizzati non si accumulano** — ogni periodo
pagato parte da zero. Dillo chiaramente nella pagina dei prezzi.

---

## 7. Fatturazione

### `POST /api/stripe/subscribe`

```json
{ "plan_id": "pro" }
```

Richiede un utente autenticato. Restituisce `{"session_id": "cs_…", "url": "https://checkout.stripe.com/…"}`.

**Reindirizza il browser a `url`.** Non provare a incorporarlo.

Al ritorno, la pagina account viene aperta con `?subscription=success` o
`?subscription=cancel`. Mostra il messaggio appropriato. Nota che i crediti arrivano
da un webhook di Stripe, quindi possono ritardare di un secondo o due rispetto al
redirect — rifai la fetch di `/api/credits` invece di darlo per scontato.

Gli URL di ritorno sono costruiti **lato server dalla configurazione**
(`SG_DASHBOARD_URL`), non dal tuo `Origin`: puntano sempre alla pagina account di
SilverGate anche quando il checkout è partito da una piattaforma. Non c'è nulla da
passare.

`400` piano sconosciuto. `401` non autenticato. `503` fatturazione non ancora
configurata.

### `POST /api/stripe/portal`

Body opzionale `{"return_url": "https://…"}`. Restituisce `{"url": "…"}`. Reindirizza
il browser lì. Questa è la pagina ospitata da Stripe per cambiare piano, aggiornare una
carta e annullare — quindi **non costruire una UI di annullamento**, linka a questa.

### Dismessi

`GET /api/stripe/packs` e `POST /api/stripe/create-checkout-session` ora restituiscono
**`410`** rimandando a `/api/plans` e `/api/stripe/subscribe`. I pacchetti di crediti
una tantum non esistono più.

---

## 8. Registrazione, verifica email e reset della password

### `POST /api/register`

```json
{ "username": "mario", "email": "user@example.com", "tag": "1234",
  "password": "…", "referral_code": "aB3xY9zQ", "redirect": "https://…" }
```

`username`, `tag`, `referral_code` e `redirect` sono opzionali.

**200:**

```json
{ "message": "Registration successful",
  "verification_email_sent": true,
  "user": { "id": "…", "email": "…", "username": "…", "tag": "…",
            "credits": 0, "referral_code": "…", "email_verified": false } }
```

**Nessuna sessione viene creata.** L'utente non è ancora autenticato — lo diventa
quando clicca il link nell'email di verifica. Quindi dopo la registrazione mostra
"controlla la tua email", non reindirizzare alla dashboard.

- `400` `{"error": "Email already registered"}` se l'indirizzo è già in uso.
- `400` password più corta di 8 caratteri.
- Se `verification_email_sent` è `false`, l'account è stato creato ma l'email è
  fallita — offri l'azione di reinvio.

### Link di verifica

Il link nell'email punta alla pagina del **frontend** (`SG_EMAIL_VERIFICATION_URL`,
`https://silver.fromzerotohero.io/verify-email` per default) e porta `?token=…` e, se la
registrazione ne ha passato uno, `&redirect=…`. Quella pagina chiama l'endpoint qui
sotto, che imposta il cookie di sessione, quindi l'utente è autenticato senza aver mai
compilato un form di login.

Onora `redirect` quando è un percorso relativo al sito (`/qualcosa`) e altrimenti
ricadi sulla pagina account — una piattaforma che avvia la registrazione lo passa per
far tornare l'utente dentro di sé. Non seguirlo mai se è un URL assoluto: renderebbe il
link di verifica un open redirect.

Lato server esiste un'alternativa: impostando `SG_EMAIL_VERIFY_VIA_API=true` l'email
punta a `GET /api/auth/verify?token=…`, che verifica e crea la sessione in una sola
navigazione senza pagina intermedia. È una via di fuga per quando il frontend non è
disponibile; il flusso con la pagina qui sopra è quello in uso.

### `POST /api/sso/verify-email`

```json
{ "token": "…" }
```

**200** imposta il cookie di sessione e restituisce
`{"message": "Email verified successfully", "token": "…", "user": {…}}`. Poi manda
l'utente a `redirect`, o alla pagina account.

`401` se il token è non valido o scaduto. Il token è valido per 24 ore.

### `POST /api/sso/send-verification`

```json
{ "email": "user@example.com", "redirect": "https://…" }
```

Reinvia l'email di verifica. **Restituisce sempre `200`** con lo stesso messaggio,
che l'indirizzo sia in sospeso, già verificato o sconosciuto — come
`forgot-password`, questo endpoint di proposito non rivela quali email sono
registrate. Mostra il `message` restituito così com'è; non aggiungere uno stato
"account inesistente", perché l'API non lo dice mai.

### `POST /api/sso/forgot-password`

```json
{ "email": "user@example.com" }
```

**Restituisce sempre 200**, che l'account esista o no — questo endpoint di proposito
non rivela quali email sono registrate. Mostra in ogni caso lo stesso messaggio "se
esiste un account, è stato inviato un codice".

### `POST /api/sso/verify-reset-code`

```json
{ "email": "user@example.com", "code": "483920" }
```

**200:** `{"message": "Code verified", "reset_token": "…"}` — il token di reset è
valido per 15 minuti.

`400` per un codice errato o scaduto. Il codice stesso è valido per 15 minuti.

**Dopo 5 tentativi errati il codice viene bruciato** e non può più essere usato
nemmeno se il tentativo successivo è corretto — `400` in ogni caso. Su `400`
ripetuti, invita l'utente a richiedere un nuovo codice invece di controllare cosa ha
digitato; l'API di proposito non distingue un codice errato da uno esaurito.

### `POST /api/sso/reset-password`

```json
{ "token": "…", "password": "…" }
```

Minimo 8 caratteri. **Tutte le sessioni vengono revocate e non ne viene creata una
nuova** — chi reimposta la password non è necessariamente il proprietario, quindi dopo
mandalo alla pagina di login.

`401` token di reset non valido o scaduto.

---

## 9. Endpoint pubblici

### `GET /api/stats/users`

Non richiede autenticazione. `{"count": 1284}`. Usato per il contatore "posti
rimanenti" nelle pagine di marketing. Aggiungi un fallback per una chiamata fallita —
l'endpoint restituisce `{"count": 0}` invece di andare in errore, quindi tratta `0`
come "sconosciuto" e non come "vuoto".

---

## 10. Checklist pagina per pagina

### Pagine di marketing (`home`, `homepage`, `landing`)
- `GET /api/stats/users` — il contatore delle iscrizioni.
- `GET /api/session` — sostituisci "Sign in" con l'avatar/il nome dell'utente
  nell'header.

### `login`
1. Al caricamento, `GET /api/session`. **Se 200, reindirizza immediatamente** a
   `return_to` o alla dashboard — non renderizzare mai il form.
2. Leggi `?return_to=` (o `?redirect=`) e manda l'utente lì dopo un login riuscito.
3. `POST /api/auth/login`.
4. Su `403` con `requires_verification`, offri "reinvia email di verifica"
   (`POST /api/sso/send-verification`).
5. Su `401`, mostra "email o password non validi".

### `register`
- `POST /api/register`, poi mostra lo stato "controlla la tua email".
- Valida la password lato client a 8+ caratteri così l'utente non viene respinto.
- Porta `?redirect=` fino alla registrazione e dentro il link nell'email.

### Verifica email
- Lascia che sia l'API a gestirlo (§8) oppure invia il token a
  `/api/sso/verify-email`, poi vai alla dashboard.

### `forgot-password` → codice → `reset-password`
- `POST /api/sso/forgot-password` → `POST /api/sso/verify-reset-code` →
  `POST /api/sso/reset-password` → poi la pagina di login.

### `dashboard`
| Pannello | Chiamata |
|---|---|
| Guardia / identità | `GET /api/session` |
| **Barra di avanzamento, piano, CTA di upgrade** | `GET /api/credits` |
| Profilo, info referral | `GET /api/me` |
| Cronologia transazioni | `GET /api/transactions` |
| Modifica username / tag | `PUT /api/profile` |
| Cambio password | `POST /api/auth/change-password` |
| Lista dispositivi / disconnetti un dispositivo | `GET /api/auth/sessions` · `DELETE /api/auth/sessions/<id>` |
| Disconnetti ovunque | `POST /api/auth/logout-all` |
| Elimina account | `DELETE /api/me` |
| Tabella prezzi | `GET /api/plans` |
| Abbonati / gestisci abbonamento | `POST /api/stripe/subscribe` · `POST /api/stripe/portal` |
| Ritorno dal pagamento | `?subscription=success\|cancel`, poi rifai la fetch di `/api/credits` |

### `terms`, `privacy`, `who-we-are`, `work-with-us`
Statiche. Chiama `GET /api/session` solo se l'header ne ha bisogno.

### Non spetta a te costruirli
- `/api/admin/*` — la piattaforma di controllo admin, protetta da un header
  `X-Admin-Code`.
- `/api/streamer/*` — il portale partner. Gli streamer **non** sono account utente:
  accedono con un `id_code` + password e ricevono un Bearer token, un sistema
  completamente separato dal cookie di sessione.
- `/api/internal/*`, `/api/user/*`, `/api/sso/introspect`, `/api/sso/token` — da server
  a server, per le piattaforme e i job schedulati. Non chiamarli mai da un browser.

---

## 11. Sviluppo locale

```sh
cd sg
cp .env.example .env          # inserisci SUPABASE_URL / SUPABASE_KEY
pip install -r requirements.txt
cd backend && python app.py   # http://127.0.0.1:4001
```

**Usa lo stesso hostname per il frontend e per l'API.** Se il frontend è servito da
`localhost:3000` e l'API è raggiunta su `127.0.0.1:4001`, il browser tratta i due come
siti diversi e `SameSite=Lax` rifiuterà di inviare il cookie — verrai disconnesso a
ogni richiesta e sembrerà che il backend sia rotto. Avvia l'API con
`SG_HOST=localhost`, e metti l'origin di sviluppo in `SG_CORS_ORIGINS` oppure servi il
frontend attraverso lo stesso host.

In sviluppo il cookie non è `Secure` (così il semplice HTTP funziona) ed è host-only
(quindi non serve un dominio condiviso). In produzione è l'opposto: `Secure`, e
limitato al dominio del brand così ogni piattaforma lo condivide.

---

## 12. Note di migrazione per chi ricostruisce il frontend

| Vecchio comportamento | Nuovo comportamento |
|---|---|
| `metalgate_token` in `localStorage` + `sessionStorage` | Rimosso. Solo cookie `HttpOnly`. `credentials: 'include'` ovunque |
| `POST /api/login` non restituiva alcun token; `POST /api/sso/login` restituiva un JWT di 24h | Un unico set di endpoint. Il token restituito è di breve durata e solo per i server |
| `POST /api/sso/verify-token` a ogni caricamento di pagina | `GET /api/session` |
| Crediti mostrati come numero | Barra di avanzamento `usage.percent` |
| La cronologia transazioni non aveva un discriminante di tipo | Viene restituito `type` (`subscription_grant`, `purchase`, `bonus`, `deduction`) |
| Pacchetti di crediti una tantum, `POST /api/stripe/create-checkout-session` | Piani mensili, `POST /api/stripe/subscribe`. I pacchetti restituiscono `410` |
| Form di login sempre renderizzato | Controlla prima `/api/session` e reindirizza se autenticato |
| "Never log in again" era un'aspirazione | Funziona: la sessione non ha scadenza, e il logout la revoca ovunque |

### Da non fare
- Memorizzare qualsiasi credenziale in `localStorage`, `sessionStorage` o in un cookie
  leggibile da JS.
- Leggere o analizzare `document.cookie`.
- Inviare `Authorization: Bearer …` dal codice del browser.
- Mostrare agli utenti i conteggi grezzi dei crediti.
- Costruire una tua UI di annullamento o di checkout invece delle pagine ospitate da
  Stripe.
- Codificare a mano i nomi dei piani, i prezzi o il testo dell'upgrade — arrivano
  dall'API.
