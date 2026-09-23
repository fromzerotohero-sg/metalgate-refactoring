# From Zero To Hero — Streamer portal

Dedicated Next.js partner dashboard for streamers and managers. It uses the
SilverGate streamer routes, not the user session API:

- `POST /api/streamer/login` authenticates an `id_code` and password.
- `GET /api/streamer/dashboard` provides the profile and direct team data.
- `GET /api/streamer/:id/subscribed` provides the authenticated streamer's full
  network, including referral reporting and pagination.

A manager's network endpoint already includes referrals acquired by the whole
branch. The UI filters those returned results for a selected direct subordinate;
it does not call a subordinate's URL, because the backend correctly rejects
cross-streamer reporting requests.

## Run locally

```sh
npm install
cp .env.example .env.local
npm run dev
```

Set `API_PROXY_TARGET` to the SilverGate backend origin (without `/api`) and
leave `NEXT_PUBLIC_API_URL=/api`. The browser then sends bearer tokens only to
this app's same-origin `/api` proxy. Set `NEXT_PUBLIC_SIGNUP_URL` to the central
registration page so copied referral links reach the user-facing frontend.

## Verify

```sh
npm run typecheck
npm run build
```

The streamer token is held in `sessionStorage`, not `localStorage`, so it is
cleared when the browser tab session ends. It is never put in the URL or rendered
into the page.
