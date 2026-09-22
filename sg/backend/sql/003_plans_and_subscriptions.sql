-- =============================================================================
-- SilverGate — 003: plans, subscriptions and period usage
-- =============================================================================
-- Required in addition to 002. Without this:
--   * `/api/credits` and `/api/me` degrade to "no plan" (they catch the error),
--   * checkout cannot record a subscription,
--   * consumption stops tracking period usage.
--
-- Additive and idempotent. No existing table, column or row is dropped.
--
-- WHY: one-time credit packs have been replaced by monthly subscriptions.
-- `users.credits_balance` therefore changes meaning from "purchased credits" to
-- "plan credits remaining in the current billing period". Leftover credits do NOT
-- roll over: each paid invoice overwrites the balance with the plan allowance.
-- =============================================================================

-- ── subscriptions ───────────────────────────────────────────────────────────
-- One subscription per user (`user_id` is unique and the application upserts on
-- it). Rows are never deleted: a cancelled subscription stays readable so the
-- admin platform can see what an account used to be on.
create table if not exists public.subscriptions (
    id                       uuid        primary key default gen_random_uuid(),
    user_id                  uuid        not null unique
                                             references public.users(id) on delete cascade,
    plan_id                  text        not null,
    status                   text        not null,
    stripe_customer_id       text,
    stripe_subscription_id   text        unique,
    stripe_price_id          text,
    -- The invoice that last granted an allowance. Written ONLY by the granting
    -- path, which makes it a reliable idempotency marker: `current_period_start`
    -- is also written by other handlers and cannot be used to decide whether a
    -- grant already happened.
    last_granted_invoice_id  text,
    credits_per_period       integer     not null default 0,
    current_period_start     timestamptz,
    current_period_end       timestamptz,
    cancel_at_period_end     boolean     not null default false,
    started_at               timestamptz,
    canceled_at              timestamptz,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now()
);

comment on table  public.subscriptions is
    'One Stripe subscription per user. plan_id is a key into the PLANS config.';
comment on column public.subscriptions.credits_per_period is
    'Snapshot of the plan allowance at sync time, so history survives a plan edit.';

create index if not exists idx_subscriptions_status        on public.subscriptions (status);
create index if not exists idx_subscriptions_period_end    on public.subscriptions (current_period_end);
create index if not exists idx_subscriptions_stripe_sub    on public.subscriptions (stripe_subscription_id);
create index if not exists idx_subscriptions_stripe_cust   on public.subscriptions (stripe_customer_id);

-- Added separately so this migration is safe to re-run against a database where
-- the table already exists.
alter table public.subscriptions
    add column if not exists last_granted_invoice_id text;

comment on column public.subscriptions.last_granted_invoice_id is
    'Invoice id that last granted a period allowance. Only the granting path '
    'writes it, so it is the idempotency guard for duplicate invoice.paid events.';

-- ── stripe_events ───────────────────────────────────────────────────────────
-- Webhook idempotency and audit. Stripe retries on any non-2xx and duplicate
-- delivery is normal, so the event id is the deduplication key. The raw payload
-- is kept: it is the only complete record of what Stripe actually told us.
create table if not exists public.stripe_events (
    id           text        primary key,   -- Stripe's evt_… id
    type         text        not null,
    received_at  timestamptz not null default now(),
    payload      jsonb
);

comment on table public.stripe_events is
    'One row per processed Stripe event. Primary key on the event id makes '
    'reprocessing impossible. The row is deleted if a handler fails, so the '
    'retry can succeed.';

create index if not exists idx_stripe_events_type        on public.stripe_events (type);
create index if not exists idx_stripe_events_received_at on public.stripe_events (received_at desc);

-- ── users: period usage counter ─────────────────────────────────────────────
-- Consumption against the allowance, INCLUDING consumption paid for by temporary
-- credits. That is what lets the progress bar read above 100% once a user is
-- running on temporary credits ("overfilling the bar").
--
-- Reset to 0 by every paid invoice, alongside the allowance.
alter table public.users
    add column if not exists credits_used_current_period integer not null default 0;

comment on column public.users.credits_used_current_period is
    'Credits consumed in the current billing period. 0 at period start. May '
    'exceed the plan allowance when temporary credits have been spent.';

create index if not exists idx_users_stripe_customer_id on public.users (stripe_customer_id);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Users who bought one-off packs have spendable credits but no plan. Their
-- balance is preserved and simply shows as "no plan" until they subscribe.
-- Nothing to backfill for the counter: nobody has consumed against a period yet.

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Supabase is managed Postgres reached only through the backend's service-role
-- key, which bypasses RLS. Enabled with no policies so these tables are not
-- reachable if PostgREST is ever exposed publicly. (architecture/README.md, D2.)
alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;

-- ── Deprecation notice ──────────────────────────────────────────────────────
-- `process_referral_purchase` (created by setup_referrals.sql) was called on
-- one-off purchases. Purchases are gone, so the application no longer calls it;
-- subscription revenue is paid out by billing.payout_streamers instead.
--
-- The function is left in place rather than dropped: dropping it is a destructive
-- change with no benefit, and the historical rows it wrote are still read by the
-- streamer dashboard. No `COMMENT ON FUNCTION` is issued here because the
-- signature varies between deployments and a wrong arity would fail this
-- migration.
