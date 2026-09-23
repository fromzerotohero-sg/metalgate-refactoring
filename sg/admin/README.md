# From Zero To Hero — Admin panel

Standalone Next.js admin dashboard for SilverGate operators. It talks only to
the `/api/admin/*` routes, authenticating every request with the shared admin
code (`X-Admin-Code`) and, when `SG_ADMIN_TOTP_SECRET` is set on the backend,
a TOTP code (`X-Admin-TOTP`).

- Overview: KPI cards, 30-day activity chart, latest transactions.
- Users: search, status filters, pagination, per-user 360° detail with profile,
  credit stats, transaction history, referrals and temporary credit grants.

## Run locally

```sh
npm install
cp .env.example .env.local
npm run dev
```

Set `API_PROXY_TARGET` to the SilverGate backend origin (without `/api`) and
leave `NEXT_PUBLIC_API_URL=/api`: the browser then sends the admin credentials
only to this app's same-origin `/api` proxy.

## Verify

```sh
npm run typecheck
npm run build
```

The admin code is held in `sessionStorage` (cleared when the tab closes), the
TOTP only in memory. Neither is ever put in the URL or rendered into the page.
