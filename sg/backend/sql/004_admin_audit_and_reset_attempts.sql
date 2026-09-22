-- =============================================================================
-- SilverGate — 004: admin audit trail and reset-code attempt limiting
-- =============================================================================
-- Required in addition to 002 and 003. Without this:
--   * authenticated admin requests are still served, but nothing is recorded, so
--     a leaked admin credential leaves no trace of what it was used for;
--   * `POST /api/sso/verify-reset-code` cannot count failed attempts, so a 6-digit
--     reset code is bounded only by the rate limiter.
--
-- Additive and idempotent. No existing table, column or row is dropped.
--
-- WHY: the admin API can read every user's data and move credits. Two gaps matter
-- more than the rest:
--
--   1. DETECTION. If the credential ever leaks, "what did they do?" must be
--      answerable from the database rather than reconstructed from application
--      logs that Vercel rotates.
--   2. BRUTE FORCE. A 6-digit code has 1,000,000 combinations inside a 15-minute
--      window. Rate limiting is per-IP and therefore weak against a distributed
--      attempt; a per-code attempt counter is not.
-- =============================================================================

-- ── admin_audit_log ─────────────────────────────────────────────────────────
-- One row per authenticated admin request. Deliberately append-only from the
-- application's point of view: nothing in the codebase updates or deletes it.
--
-- `path` is stored verbatim, including any user id in it. That is the information
-- an investigation needs, and the table is only readable with the service key.
create table if not exists public.admin_audit_log (
    id          bigint generated always as identity primary key,
    created_at  timestamptz not null default now(),
    method      text        not null,
    path        text        not null,
    status      integer,
    ip          inet,
    user_agent  text,
    -- Which credential acted. Today that is always the shared admin code; when
    -- architecture/08 lands, this becomes the operator identity and the column
    -- needs no change.
    actor       text        not null default 'shared_admin_code'
);

comment on table public.admin_audit_log is
    'Append-only record of authenticated admin requests, for detection after a credential leak.';

-- Investigations read "what happened, newest first" and "what did this address
-- do", so those two access paths get an index. The table is expected to stay
-- small (an admin panel, not user traffic).
create index if not exists admin_audit_log_created_at_idx
    on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_ip_idx
    on public.admin_audit_log (ip);
create index if not exists admin_audit_log_path_idx
    on public.admin_audit_log (path);

-- ── password_resets.attempts ────────────────────────────────────────────────
-- Counts failed verifications against a single issued code. At the limit the code
-- is burned and the user must request a new one, so guessing cannot continue
-- against the same code from many addresses.
alter table public.password_resets
    add column if not exists attempts integer not null default 0;

comment on column public.password_resets.attempts is
    'Failed verification attempts against this code. The code is invalidated at the application limit.';

-- ── Housekeeping note ───────────────────────────────────────────────────────
-- `admin_audit_log` and `password_resets` are the two tables that grow without
-- bound from the application's perspective. A scheduled job (Vercel Cron) should
-- eventually drop audit rows older than a retention period the business chooses —
-- commonly one year — and expired password resets. Neither is implemented yet;
-- both are cheap to add to the existing `/api/internal/expire-grants` style job.
