-- =============================================================================
-- SilverGate — 008: email campaign history
-- =============================================================================
-- Required for `GET /api/admin/email-campaign/history`. Without it the history
-- endpoint returns an empty list with `history_available: false` and the send
-- endpoint simply skips recording — sending itself is unaffected.
--
-- Additive and idempotent. No existing table, column or row is dropped.
--
-- WHY: campaigns go out through Resend and the only trace was the audit log's
-- free-text `detail`. A structured row per send answers "what went out, to how
-- many, and did it land" without parsing log text, and feeds the admin panel's
-- history view.
--
-- One row per *send request*, not per recipient: per-recipient delivery status
-- is Resend's job (webhooks, its dashboard); what the admin panel needs is the
-- campaign-level outcome the send endpoint already computes (`sent`/`failed`).
-- =============================================================================

create table if not exists public.email_campaigns (
    id               uuid        primary key default gen_random_uuid(),
    created_at       timestamptz not null default now(),
    -- 'campaign' (filtered or multi-recipient), 'test' (test_email set),
    -- 'single' (exactly one explicit recipient and no filters).
    mode             text        not null check (mode in ('campaign', 'test', 'single')),
    subject          text        not null,
    heading          text,
    -- The normalized filters the recipients were selected with (all defaults
    -- when the send used an explicit recipient list).
    filters          jsonb,
    recipients_count integer     not null default 0,
    sent             integer     not null default 0,
    failed           integer     not null default 0,
    -- The caller-supplied idempotency id, so a retried campaign is recognisable
    -- as the same send.
    campaign_id      text,
    actor            text        not null default 'shared_admin_code'
);

comment on table public.email_campaigns is
    'One row per email campaign send request: what was sent, to how many, and the outcome.';

-- The history view reads newest first.
create index if not exists idx_email_campaigns_created_at
    on public.email_campaigns (created_at desc);

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Supabase is used strictly as managed Postgres, reached only through the
-- backend's service-role key, which bypasses RLS. Enabled with no policies so
-- the table is not reachable if PostgREST is ever exposed publicly.
-- (architecture/README.md, decision D2.)
alter table public.email_campaigns enable row level security;
