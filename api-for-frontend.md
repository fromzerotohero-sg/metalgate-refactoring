# SilverGate — API guide for frontend developers

**Status: draft.** The backend in `sg/` is written and reviewed but has **not been
run yet** and its migrations have not been applied. Treat this as a specification
until the first successful deployment.

Italian version: [`api-for-frontend.it.md`](./api-for-frontend.it.md)

---

## 1. Read this first: authentication is a cookie, not a token

This is the single biggest difference from the old frontend, and getting it wrong
will break everything else.

SilverGate keeps the user signed in with **one opaque session token in an
`HttpOnly` cookie**. That means:

- **JavaScript cannot read the token.** It is `HttpOnly` on purpose — that is what
  stops an XSS bug on any platform from stealing a credential that never expires.
- **There is nothing to put in `localStorage`.** The old `metalgate_token` is gone.
  Do not store tokens, do not read `document.cookie`, do not send an
  `Authorization` header from the browser.
- **Every request must send the cookie**, so every `fetch` needs
  `credentials: 'include'`.
- **To find out whether the user is signed in, ask the server:**
  `GET /api/session` returns `200` + the user, or `401`.

The pay-off: the cookie is scoped to the whole brand domain, so a user who signs in
once on any platform is signed in on all of them, and the session does not expire
until they log out.

### The one rule for every page

```js
// Run this on page load, before rendering anything auth-dependent.
const res = await fetch(`${API}/session`, { credentials: 'include' });

if (res.status === 200) {
  const user = await res.json();   // signed in
} else {
  // 401 — signed out. Show the Login link. Do NOT show a broken page.
}
```

**Never show the login form without asking first.** If `/api/session` returns 200,
the visitor is already signed in and must be redirected straight through. Showing a
login form to a signed-in user is the bug the old `login.html` had.

---

## 2. Base URL and environment

| | |
|---|---|
| Production | `https://api.fromzerotohero.io/api` |
| Local development | `http://localhost:4001/api` (see §11) |

All paths below are relative to that base. So `GET /api/session` means
`GET https://api.fromzerotohero.io/api/session`.

---

## 3. Conventions every request must follow

| Convention | Why |
|---|---|
| `credentials: 'include'` on **every** call | Otherwise the browser will not send or accept the session cookie |
| `Content-Type: application/json` on requests with a body | The API parses JSON; most endpoints reject non-JSON bodies |
| Your origin must be in the server's `SG_CORS_ORIGINS` | Requests that carry the cookie from an unlisted origin get `403 {"error": "Origin not allowed"}` |
| Do not retry a `401`/`403` in a loop | They are not transient |

### Error shape

Every failure is JSON with an `error` key, plus optional detail:

```json
{ "error": "Email and password are required" }
```

One specific case carries extra fields, and the frontend must handle it:

```json
{
  "error": "Email not verified",
  "message": "Please verify your email before logging in",
  "requires_verification": true
}
```

### Status codes

| Code | Meaning |
|---|---|
| 200 | Success |
| 400 | The request is wrong (missing/invalid fields, unknown plan…) |
| 401 | Not signed in, wrong credentials, or invalid token |
| 403 | Signed in but not allowed — an unverified email, or an unlisted `Origin` |
| 404 | Not found (unknown user, unknown session) |
| 410 | **Retired endpoint** — see the message, it tells you where it moved |
| 429 | Rate limited. `{"error": "Too many requests…", "limit": "10 per 1 minute"}` |
| 500 | Server fault |
| 503 | A dependency is not configured (e.g. billing) |

Rate limits are per IP address and apply to the whole endpoint, not per user.

---

## 4. Session and authentication

### `GET /api/session`
Aliases: `/api/auth/session`

The frontend's identity probe. Call it on every page load and after any redirect.

**200** — signed in:

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

**401** — `{"error": "Unauthorized"}` — signed out.

> `credits` here is the raw plan balance. **Do not show it to users.** Render the
> progress bar from `/api/credits` instead (§6).

### `POST /api/auth/login`
Aliases: `/api/login`, `/api/sso/login`

```json
{ "email": "user@example.com", "password": "…", "service": "web" }
```

`service` is optional; send your platform id (e.g. `"efootball"`) so login
telemetry records where the user came from.

**200** — sets the session cookie, and returns:

```json
{
  "message": "Login successful",
  "token": "<short-lived access token>",
  "user": { "id": "…", "email": "…", "username": "…", "tag": "…",
            "credits": 142, "email_verified": true }
}
```

> **Ignore `token`.** It is a 10-minute credential for *platform servers*, not for
> browsers. The cookie is what signs the user in. Storing this token is exactly the
> mistake this architecture removes.

**403** — unverified email; see the `requires_verification` shape in §3. Offer the
"resend verification email" action.

**401** — `{"error": "Invalid credentials"}`.

**400** — missing email or password.

### `POST /api/auth/logout`
Alias: `/api/logout`

No body. Clears the cookie and revokes the session everywhere. Idempotent — safe to
call when already signed out. Returns `{"message": "Logged out successfully"}`.

### `POST /api/auth/logout-all`

Signs the user out of **every** device and platform. Returns
`{"message": "Logged out of all devices", "sessions_revoked": 3}`.

### `GET /api/auth/sessions`

For a "your devices" panel.

```json
{ "sessions": [
  { "id": "…", "current": true, "created_at": "2026-09-17T09:00:00+00:00",
    "last_seen_at": "2026-09-17T18:22:00+00:00", "ip": "203.0.113.7",
    "user_agent": "Mozilla/5.0 …", "service": "web" }
] }
```

### `DELETE /api/auth/sessions/<session_id>`

Signs one other device out. `404` if it is not yours or already revoked.

### `POST /api/auth/change-password`

```json
{ "current_password": "…", "new_password": "…" }
```

Minimum 8 characters. **Every other session is revoked** on success, so the user
stays signed in only on the device they are using. Returns
`{"message": "Password updated. Other devices have been signed out."}`.

`401` if `current_password` is wrong.

---

## 5. Profile and account

### `GET /api/me`

The full profile. Use this for the dashboard; use `/api/session` for a cheap
identity check.

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
  "plan": { "…": "see §6" },
  "usage": { "…": "see §6" },
  "upgrade": { "…": "see §6" },
  "referral_code": "aB3xY9zQ",
  "referral_count": 2,
  "referral_bonus_credits": 50,
  "referral_earnings": 100,
  "created_at": "2026-01-04T12:00:00+00:00"
}
```

Credit fields are raw numbers and are **not** for end-user display. They exist for
the admin platform and for debugging.

### `PUT /api/profile`

```json
{ "username": "mario", "tag": "1234" }
```

Send only what changed. `400` if you send neither. Returns
`{"message": "Profile updated", "user": {…}}` where `user` has the `/api/session`
shape.

### `DELETE /api/me`

Deletes the account permanently and revokes every session. Returns
`{"message": "Account deleted successfully"}`. **Ask for explicit confirmation** —
there is no undo and no soft-delete.

### `GET /api/transactions`

The 50 most recent entries, newest first.

```json
{ "transactions": [
  { "id": "…", "amount": -12, "description": "Coaching session analysis",
    "status": "completed", "timestamp": "2026-09-16T20:11:00+00:00" }
] }
```

`amount` is negative for spend and positive for a grant.

---

## 6. Plans, usage and the progress bar

### `GET /api/credits`
Aliases: `/api/credits/`, `/api/plan/usage`

**This is the endpoint that replaces showing users their credit count.** It returns
a usage percentage for a progress bar, the current plan, and the upgrade call to
action.

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
    "url": "https://home.fromzerotohero.io/pricing"
  }
}
```

**How to render it**

- **The bar** is `usage.percent`, 0→100. When `usage.overfilled` is `true` the user
  has spent their whole plan allowance and is running on temporary credits — show
  the bar full and mark it as "bonus credits", do not clamp silently.
- **`plan` may be `null`** (never subscribed). Handle it: show the free state and
  the upsell, not an error.
- **`plan.active === false`** means the subscription lapsed or was cancelled. Show
  "your subscription has ended" plus a resubscribe CTA.
- **`plan.cancel_at_period_end === true`** means it is cancelled but still running
  until `current_period_end`. Say so.
- **`upgrade` may be `null`** — show the CTA only when it is present. Use
  `upgrade.cta_label` as the button text and `upgrade.url` as the link; do not build
  the wording yourself, it is generated server-side so it stays consistent.
- **Ignore the `credits` block for user-facing display.**

### `GET /api/plans`

Public — the pricing page can call it before login.

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

Plans are monthly and **unused credits do not roll over** — each paid period starts
from zero. Say that plainly on the pricing page.

---

## 7. Billing

### `POST /api/stripe/subscribe`

```json
{ "plan_id": "pro" }
```

Requires a signed-in user. Returns `{"session_id": "cs_…", "url": "https://checkout.stripe.com/…"}`.

**Redirect the browser to `url`.** Do not try to embed it.

On return, the dashboard is opened with `?subscription=success` or
`?subscription=cancel`. Show the appropriate message. Note the credits arrive from a
Stripe webhook, so they may lag the redirect by a second or two — re-fetch
`/api/credits` rather than assuming.

`400` unknown plan. `401` not signed in. `503` billing not configured yet.

### `POST /api/stripe/portal`

Optional body `{"return_url": "https://…"}`. Returns `{"url": "…"}`. Redirect the
browser there. This is Stripe's hosted page for changing plan, updating a card, and
cancelling — so **do not build a cancellation UI**, link to this.

### Retired

`GET /api/stripe/packs` and `POST /api/stripe/create-checkout-session` now return
**`410`** pointing at `/api/plans` and `/api/stripe/subscribe`. One-off credit packs
no longer exist.

---

## 8. Registration, email verification and password reset

### `POST /api/register`

```json
{ "username": "mario", "email": "user@example.com", "tag": "1234",
  "password": "…", "referral_code": "aB3xY9zQ", "redirect": "https://…" }
```

`username`, `tag`, `referral_code` and `redirect` are optional.

**200:**

```json
{ "message": "Registration successful",
  "verification_email_sent": true,
  "user": { "id": "…", "email": "…", "username": "…", "tag": "…",
            "credits": 0, "referral_code": "…", "email_verified": false } }
```

**No session is created.** The user is not signed in yet — that happens when they
click the link in the verification email. So after registering, show "check your
email", do not redirect to the dashboard.

- `400` `{"error": "Email already registered"}` if the address is already used.
- `400` password shorter than 8 characters.
- If `verification_email_sent` is `false`, the account was created but the email
  failed — offer the resend action.

### Verification link

Best practice: the email link points **straight at the API**,
`GET /api/auth/verify?token=…`, which verifies the account, **creates the session**,
and redirects the browser into the dashboard. The user registers once and is never
asked to log in again.

If you prefer a page of your own, it can read `?token=` and call:

### `POST /api/sso/verify-email`

```json
{ "token": "…" }
```

**200** sets the session cookie and returns
`{"message": "Email verified successfully", "token": "…", "user": {…}}`. Then send
the user to the dashboard.

`401` if the token is invalid or expired. The token is valid for 24 hours.

### `POST /api/sso/send-verification`

```json
{ "email": "user@example.com", "redirect": "https://…" }
```

Resends the verification email. `200` always for a pending registration;
`{"message": "Email already verified"}` if it is already done; `404` if unknown.

### `POST /api/sso/forgot-password`

```json
{ "email": "user@example.com" }
```

**Always returns 200**, whether or not the account exists — this endpoint
deliberately does not reveal which emails are registered. Show the same
"if an account exists, a code has been sent" message either way.

### `POST /api/sso/verify-reset-code`

```json
{ "email": "user@example.com", "code": "483920" }
```

**200:** `{"message": "Code verified", "reset_token": "…"}` — the reset token is
valid for 15 minutes.

`400` for a wrong or expired code. The code itself is valid for 15 minutes.

### `POST /api/sso/reset-password`

```json
{ "token": "…", "password": "…" }
```

Minimum 8 characters. **All sessions are revoked and no new one is created** — the
person resetting the password is not necessarily the owner, so send them to the
login page afterwards.

`401` invalid or expired reset token.

---

## 9. Public endpoints

### `GET /api/stats/users`

No auth needed. `{"count": 1284}`. Used for the "spots remaining" counter on the
marketing pages. Add a fallback for a failed call — the endpoint returns
`{"count": 0}` rather than erroring, so treat `0` as "unknown" rather than "empty".

---

## 10. Page-by-page checklist

### Marketing pages (`home`, `homepage`, `landing`)
- `GET /api/stats/users` — the signup counter.
- `GET /api/session` — swap "Sign in" for the user's avatar/name in the header.

### `login`
1. On load, `GET /api/session`. **If 200, redirect immediately** to `return_to` or
   the dashboard — never render the form.
2. Read `?return_to=` (or `?redirect=`) and send the user there after a successful
   login.
3. `POST /api/auth/login`.
4. On `403` with `requires_verification`, offer "resend verification email"
   (`POST /api/sso/send-verification`).
5. On `401`, show "invalid email or password".

### `register`
- `POST /api/register`, then show the "check your email" state.
- Validate the password client-side to 8+ characters so the user is not bounced.
- Carry `?redirect=` through to registration and into the email link.

### Verify email
- Either let the API handle it (§8) or post the token to `/api/sso/verify-email`,
  then go to the dashboard.

### `forgot-password` → code → `reset-password`
- `POST /api/sso/forgot-password` → `POST /api/sso/verify-reset-code` →
  `POST /api/sso/reset-password` → then the login page.

### `dashboard`
| Panel | Call |
|---|---|
| Guard / identity | `GET /api/session` |
| **Progress bar, plan, upgrade CTA** | `GET /api/credits` |
| Profile, referral info | `GET /api/me` |
| Transaction history | `GET /api/transactions` |
| Edit username / tag | `PUT /api/profile` |
| Change password | `POST /api/auth/change-password` |
| Device list / sign out a device | `GET /api/auth/sessions` · `DELETE /api/auth/sessions/<id>` |
| Sign out everywhere | `POST /api/auth/logout-all` |
| Delete account | `DELETE /api/me` |
| Pricing table | `GET /api/plans` |
| Subscribe / manage subscription | `POST /api/stripe/subscribe` · `POST /api/stripe/portal` |
| Payment return | `?subscription=success\|cancel`, then re-fetch `/api/credits` |

### `terms`, `privacy`, `who-we-are`, `work-with-us`
Static. Call `GET /api/session` only if the header needs it.

### Not yours to build
- `/api/admin/*` — the admin control platform, gated by an `X-Admin-Code` header.
- `/api/streamer/*` — the partner portal. Streamers are **not** user accounts: they
  sign in with an `id_code` + password and receive a Bearer token, a completely
  separate system from the session cookie.
- `/api/internal/*`, `/api/user/*`, `/api/sso/introspect`, `/api/sso/token` — server
  to server, for platforms and scheduled jobs. Never call these from a browser.

---

## 11. Local development

```sh
cd sg
cp .env.example .env          # fill in SUPABASE_URL / SUPABASE_KEY
pip install -r requirements.txt
cd backend && python app.py   # http://127.0.0.1:4001
```

**Use the same hostname for the frontend and the API.** If the frontend is served
from `localhost:3000` and the API is reached at `127.0.0.1:4001`, the browser treats
the two as different sites and `SameSite=Lax` will refuse to send the cookie — you
will be signed out on every request and it will look like the backend is broken. Run
the API with `SG_HOST=localhost`, and either put your dev origin in `SG_CORS_ORIGINS`
or serve the frontend through the same host.

In development the cookie is not `Secure` (so plain HTTP works) and it is host-only
(so no shared domain is needed). Production is the opposite: `Secure`, and scoped to
the brand domain so every platform shares it.

---

## 12. Migration notes for whoever rebuilds the frontend

| Old behaviour | New behaviour |
|---|---|
| `metalgate_token` in `localStorage` + `sessionStorage` | Gone. `HttpOnly` cookie only. `credentials: 'include'` everywhere |
| `POST /api/login` returned no token; `POST /api/sso/login` returned a 24h JWT | One endpoint set. The returned token is short-lived and for servers only |
| `POST /api/sso/verify-token` on every page load | `GET /api/session` |
| Credits shown as a number | `usage.percent` progress bar |
| One-off credit packs, `POST /api/stripe/create-checkout-session` | Monthly plans, `POST /api/stripe/subscribe`. Packs return `410` |
| Login form always rendered | Check `/api/session` first and redirect if signed in |
| "Never log in again" was aspirational | It works: the session has no expiry, and logout revokes it everywhere |

### Do not
- Store any credential in `localStorage`, `sessionStorage` or a JS-readable cookie.
- Read or parse `document.cookie`.
- Send `Authorization: Bearer …` from browser code.
- Show users raw credit counts.
- Build your own cancellation or checkout UI instead of Stripe's hosted pages.
- Hard-code plan names, prices or the upgrade wording — they come from the API.
