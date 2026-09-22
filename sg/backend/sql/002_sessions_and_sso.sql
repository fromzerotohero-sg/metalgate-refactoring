-- =============================================================================
-- SilverGate — 002: sessions, SSO codes, login events
-- =============================================================================
-- This migration is REQUIRED. The application will not authenticate anyone
-- without the `sessions` table.
--
-- Apply it with the Supabase SQL editor, or:
--     psql "$SUPABASE_DB_URL" -f sql/002_sessions_and_sso.sql
--
-- Everything here is additive and idempotent: no existing table, column or row
-- is dropped or rewritten.
-- =============================================================================

-- ── sessions ────────────────────────────────────────────────────────────────
-- The user's only credential. `token_hash` is sha256(raw token); the raw token
-- is never stored. There is deliberately no `expires_at`: a session ends when it
-- is revoked, and only when it is revoked (architecture/04, decision D5).
create table if not exists public.sessions (
    id              uuid        primary key default gen_random_uuid(),
    user_id         uuid        not null references public.users(id) on delete cascade,
    token_hash      text        not null unique,
    created_at      timestamptz not null default now(),
    last_seen_at    timestamptz not null default now(),
    revoked_at      timestamptz,
    revoked_reason  text,
    ip              inet,
    user_agent      text,
    service         text
);

comment on table  public.sessions is
    'Revocable user sessions. token_hash = sha256(raw cookie token).';
comment on column public.sessions.service is
    'Which platform the sign-in came from, e.g. "efootball".';

-- Fast lookup on the hot path (one indexed read per authenticated request).
create index if not exists idx_sessions_token_hash on public.sessions (token_hash);
-- "my devices" and bulk revocation.
create index if not exists idx_sessions_user_active
    on public.sessions (user_id) where revoked_at is null;
-- Housekeeping and admin analytics.
create index if not exists idx_sessions_last_seen on public.sessions (last_seen_at);
create index if not exists idx_sessions_revoked_at on public.sessions (revoked_at);

-- ── auth_codes ──────────────────────────────────────────────────────────────
-- Single-use codes for the cross-domain SSO handoff (architecture/04 §6, Path B).
-- Codes are short lived, bound to a client and redirect URI, and burned on use,
-- so the long-lived credential never travels through a browser address bar.
create table if not exists public.auth_codes (
    id                    uuid        primary key default gen_random_uuid(),
    code_hash             text        not null unique,
    user_id               uuid        not null references public.users(id) on delete cascade,
    client_id             text        not null,
    redirect_uri          text        not null,
    code_challenge        text,
    code_challenge_method text,
    session_id            uuid        references public.sessions(id) on delete set null,
    created_at            timestamptz not null default now(),
    expires_at            timestamptz not null,
    used_at               timestamptz
);

create index if not exists idx_auth_codes_expires_at on public.auth_codes (expires_at);
create index if not exists idx_auth_codes_user_id on public.auth_codes (user_id);

-- ── login_events ────────────────────────────────────────────────────────────
-- Append-only authentication telemetry: the substrate for "which platform was
-- last used", failed-login detection and the admin analytics platform
-- (architecture/08). Answers questions that `users.last_login_by_service`
-- alone cannot.
create table if not exists public.login_events (
    id              bigserial   primary key,
    created_at      timestamptz not null default now(),
    user_id         uuid        references public.users(id) on delete set null,
    service         text,
    success         boolean     not null default true,
    failure_reason  text,
    ip              inet,
    user_agent      text
);

create index if not exists idx_login_events_created_at on public.login_events (created_at desc);
create index if not exists idx_login_events_user_id on public.login_events (user_id);
create index if not exists idx_login_events_service on public.login_events (service);

-- ── users: activity columns ─────────────────────────────────────────────────
-- `email_verified_at` was read by the old code but never written, and no
-- activity timestamp existed at all. Both are populated from now on.
alter table public.users
    add column if not exists email_verified_at timestamptz;

alter table public.users
    add column if not exists last_activity_at timestamptz;

comment on column public.users.last_activity_at is
    'Debounced heartbeat, updated at most every SG_SESSION_TOUCH_INTERVAL_MINUTES.';

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Existing verified users have no verification timestamp and no activity data.
-- Seed what can be inferred so the admin platform does not start from a hole.
update public.users
   set email_verified_at = coalesce(email_verified_at, created_at)
 where email_verified is true
   and email_verified_at is null;

update public.users
   set last_activity_at = coalesce(last_activity_at, last_login)
 where last_login is not null
   and last_activity_at is null;

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Supabase is used strictly as managed Postgres and every query comes from the
-- backend with the service-role key, which bypasses RLS. RLS is enabled with no
-- policies purely so these tables are not reachable through the public PostgREST
-- API if it is ever exposed. (architecture/README.md, decision D2.)
alter table public.sessions     enable row level security;
alter table public.auth_codes   enable row level security;
alter table public.login_events enable row level security;
