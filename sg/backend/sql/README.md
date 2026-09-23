# SQL migrations

| File | Status |
|---|---|
| `002_sessions_and_sso.sql` | **REQUIRED.** Apply before deploying. |
| `003_plans_and_subscriptions.sql` | **REQUIRED.** Apply before deploying. |
| `004_admin_audit_and_reset_attempts.sql` | **REQUIRED.** Apply before deploying. |
| `005_google_oauth.sql` | **REQUIRED for Google sign-in.** Apply before enabling the Google button. |
| `006_transaction_service.sql` | **REQUIRED for platform-spend attribution.** |
| `007_chat.sql` | **REQUIRED for the support chat** (`/api/chat/*`, `/api/admin/chat/*`) and for audit action detail. |
| `008_email_campaigns.sql` | **REQUIRED for email campaign history** (`/api/admin/email-campaign/history`). Sending works without it; nothing is recorded. |
| `setup_referrals.sql` | Already applied. Historical **— but see the warning below.** |
| `add_temp_credits.sql` | Already applied. Historical. |
| `setup_password_resets.sql` | Already applied. Historical. |
| `supabase_migration_rpc.sql` | Already applied. Historical. |

```sh
psql "$SUPABASE_DB_URL" -f 002_sessions_and_sso.sql
psql "$SUPABASE_DB_URL" -f 003_plans_and_subscriptions.sql
psql "$SUPABASE_DB_URL" -f 004_admin_audit_and_reset_attempts.sql
psql "$SUPABASE_DB_URL" -f 005_google_oauth.sql
psql "$SUPABASE_DB_URL" -f 006_transaction_service.sql
psql "$SUPABASE_DB_URL" -f 007_chat.sql
psql "$SUPABASE_DB_URL" -f 008_email_campaigns.sql
```

## Why the historical files are kept but should not be re-run

They describe schema that already exists in production, and re-running them is harmless
at best. Two are actively misleading:

- `supabase_migration_rpc.sql` creates `email_verifications` plus RLS policies built on
  `auth.uid()` / `auth.role()`. Supabase is used **strictly as managed Postgres** here,
  with no Supabase Auth, so `auth.uid()` is always null and those policies grant nothing.
  SilverGate does not use `email_verifications` either: verification is a signed,
  stateless token, because that table's foreign key points at `users(id)` while a pending
  registration lives in `tempusers`.
- `add_temp_credits.sql` records a schema the application has already moved past.

### `setup_referrals.sql` is special

It defines the `streamers`, `perc` and `credentials` tables **and** the
`process_referral_purchase` PL/pgSQL function.

The function implemented streamer payouts on one-off purchases. Those purchases
have been replaced by subscriptions, so the application **no longer calls it** —
subscription revenue is paid out by `billing.payout_streamers`, which mirrors the
same percentages and adds the loop guard the function lacked.

Do not drop or rewrite it without understanding the money flow it implements. It
is listed as historical because it has already been applied — not because it is
unused.
