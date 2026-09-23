-- =============================================================================
-- SilverGate — 009: user activity events
-- =============================================================================
-- Required for `POST /api/internal/events` (platforms reporting what a user
-- did) and `GET /api/admin/users/<id>/events` (the admin panel's per-user
-- activity timeline). Without it the ingest endpoint fails and the admin
-- endpoint answers 200 with an empty list and `events_available: false`.
--
-- Additive and idempotent. No existing table, column or row is dropped.
--
-- WHY: a platform knows things about its users that SilverGate never sees —
-- "roster updated", "build saved", "match played". One append-only row per
-- event, tagged with the platform key that reported it, lets the admin panel
-- render a single cross-platform timeline on the user detail page without each
-- platform shipping its own schema.
--
-- `meta` is free-form JSON supplied by the calling platform. It is *displayed*
-- by the admin panel, never interpreted by the backend, so no constraint on its
-- shape — the endpoint caps its size (4 KB) at ingest.
-- =============================================================================

create table if not exists public.user_events (
    id          bigint      generated always as identity primary key,
    user_id     uuid        not null references public.users(id) on delete cascade,
    -- The calling platform's client_id, or 'internal' when the brand-wide
    -- internal key was used.
    platform    text        not null,
    event_type  text        not null check (char_length(event_type) <= 64),
    -- Optional human-readable hint from the app ("Roster updated for Weekend League").
    label       text,
    meta        jsonb       not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

comment on table public.user_events is
    'Append-only activity events reported by platform apps; one row per user action, for the admin timeline.';

-- The admin timeline reads one user's events, newest first.
create index if not exists idx_user_events_user_created_at
    on public.user_events (user_id, created_at desc);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Supabase is used strictly as managed Postgres, reached only through the
-- backend's service-role key, which bypasses RLS. Enabled with no policies so
-- the table is not reachable if PostgREST is ever exposed publicly.
-- (architecture/README.md, decision D2.)
alter table public.user_events enable row level security;
