-- =============================================================================
-- SilverGate — 006: which platform recorded a credit spend
-- =============================================================================
-- Required in addition to 002–005. Additive and idempotent: no existing table,
-- column or row is dropped.
--
-- WHY: platforms now spend a user's credits through `POST /api/credits/spend`
-- with their **own** `X-Platform-Key`, instead of the brand-wide
-- `INTERNAL_API_KEY`. That removes the over-privileged shared secret from the
-- platform integration, but it also means a spend needs to say *which* platform
-- made it — the same way `sessions.service` already records where a sign-in came
-- from.
--
-- The alternative was to reconstruct attribution from application logs. That is
-- exactly what migration 004 rejects for the admin surface: Vercel rotates logs,
-- and "which platform drained this user's allowance?" must be answerable from the
-- database, not from a log line that may already be gone.
--
-- Without this migration nothing breaks: `credits.record_transaction` retries its
-- insert without the `service` column, so the ledger row is written as before and
-- only the attribution is missing.
-- =============================================================================

alter table public.transactions
    add column if not exists service varchar;

comment on column public.transactions.service is
    'client_id of the platform that recorded the spend (POST /api/credits/spend). ''internal'' for SilverGate''s own jobs; NULL for rows written before this column existed and for grants.';
