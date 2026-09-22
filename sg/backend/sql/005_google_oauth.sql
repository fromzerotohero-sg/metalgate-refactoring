-- =============================================================================
-- SilverGate — 005: external identity providers (Google)
-- =============================================================================
-- Required only for Google sign-in. Without this table the
-- /api/auth/google/* endpoints fail and every other sign-in path is unaffected,
-- so it is safe to apply ahead of enabling the button.
--
-- Additive and idempotent. No existing table, column or row is dropped.
--
-- WHY: Google is the first identity provider that is not us. The account is
-- still a `users` row and the session is still the ordinary revocable one; the
-- only new fact is *which external identity* a user is, so that a repeat sign-in
-- finds the same account without relying on the email address.
--
-- The email is deliberately NOT the key. A Google account's address can change,
-- and matching on it would either orphan the account or — worse — attach the
-- identity to whichever SilverGate account happened to hold that address next.
-- The provider's `sub` claim is stable for the life of the account, so that is
-- what is stored and matched.
-- =============================================================================

create table if not exists public.oauth_identities (
    id               uuid        primary key default gen_random_uuid(),
    user_id          uuid        not null references public.users(id) on delete cascade,
    -- Matches the `provider` constant in google_oauth.py.
    provider         text        not null,
    -- Google's `sub`: stable, unique per client, and never reused.
    provider_subject text        not null,
    -- Recorded for support and for an operator reading the table. NOT an
    -- identity — `provider_subject` is.
    email            text,
    created_at       timestamptz not null default now(),
    last_login_at    timestamptz
);

comment on table public.oauth_identities is
    'External identity (Google, …) linked to a SilverGate account, one row per provider subject.';
comment on column public.oauth_identities.provider_subject is
    'The provider''s stable subject claim (Google''s `sub`), never the email — an address can change.';

-- The uniqueness that makes the link authoritative. It is also what makes the
-- sign-in upsert safe: two concurrent first sign-ins race here, and the index
-- decides, rather than the application.
create unique index if not exists uq_oauth_identities_provider_subject
    on public.oauth_identities (provider, provider_subject);

-- "Which identities does this user have?" — a future account page listing them.
create index if not exists idx_oauth_identities_user_id
    on public.oauth_identities (user_id);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Supabase is used strictly as managed Postgres, reached only through the
-- backend's service-role key, which bypasses RLS. Enabled with no policies so
-- the table is not reachable if PostgREST is ever exposed publicly.
-- (architecture/README.md, decision D2.)
alter table public.oauth_identities enable row level security;
