-- =============================================================================
-- SilverGate — 007: operator↔customer chat, and admin audit action detail
-- =============================================================================
-- Required for the `/api/chat/*` and `/api/admin/chat/*` endpoints. Without
-- these tables they fail; everything else is unaffected.
--
-- Additive and idempotent. No existing table, column or row is dropped.
--
-- WHY: support requests currently arrive by email, which leaves no shared
-- record next to the customer's account and no way for the admin panel to show
-- an inbox. Two tables are enough: a conversation belongs to one user and
-- carries the unread counters both sides poll; a message belongs to one
-- conversation and says which side sent it.
--
-- Unread counters are denormalised on the conversation — both frontends poll
-- "how many unread?" far more often than they read threads, and recomputing the
-- count per poll would scan `chat_messages` every few seconds per open
-- conversation. The counters are maintained by the application on every insert
-- and reset on the matching read endpoint; `read_at` on the message is the
-- source of truth they can always be rebuilt from.
-- =============================================================================

create table if not exists public.chat_conversations (
    id                  uuid        primary key default gen_random_uuid(),
    user_id             uuid        not null references public.users(id) on delete cascade,
    status              text        not null default 'open'
                                    check (status in ('open', 'closed')),
    subject             text,
    last_message_at     timestamptz,
    unread_admin_count  integer     not null default 0,
    unread_user_count   integer     not null default 0,
    created_at          timestamptz not null default now()
);

comment on table public.chat_conversations is
    'One support thread per user request; unread counters are denormalised for the polling frontends.';

create table if not exists public.chat_messages (
    id              bigint      generated always as identity primary key,
    conversation_id uuid        not null references public.chat_conversations(id) on delete cascade,
    sender          text        not null check (sender in ('user', 'admin')),
    body            text        not null,
    created_at      timestamptz not null default now(),
    -- Set when the *other* side acknowledges the message: the user endpoint
    -- marks admin messages read, the admin thread view marks user messages.
    read_at         timestamptz
);

comment on table public.chat_messages is
    'Append-only chat messages. `read_at` is set by the receiving side and is the source of truth for the unread counters.';

-- "This user's conversations" (the customer widget).
create index if not exists idx_chat_conversations_user_id
    on public.chat_conversations (user_id);

-- Enforces the application's "at most three open threads per user" check
-- without scanning closed conversation history.
create index if not exists idx_chat_conversations_user_open
    on public.chat_conversations (user_id)
    where status = 'open';

-- The admin inbox, newest activity first.
create index if not exists idx_chat_conversations_last_message_at
    on public.chat_conversations (last_message_at desc);

-- Thread reads, the incremental `?after=<id>` polling, and the application's
-- check for the latest three consecutive user messages.
create index if not exists idx_chat_messages_conversation_id
    on public.chat_messages (conversation_id, id);

-- ── admin_audit_log.detail ──────────────────────────────────────────────────
-- 004's audit trail records method, path and status — what was touched — but
-- for a write action the *payload* matters: which manager was assigned, how
-- many credits were granted. Views set `g.admin_action_detail` and the
-- after_request hook in routes_admin.py stores it here. NULL for every read
-- and for rows written before this column existed.
alter table public.admin_audit_log
    add column if not exists detail text;

comment on column public.admin_audit_log.detail is
    'Human-readable summary of a write action (e.g. "granted 50 credits, reason: …"), set by the view via g.admin_action_detail.';

-- ── Row Level Security ──────────────────────────────────────────────────────
-- Supabase is used strictly as managed Postgres, reached only through the
-- backend's service-role key, which bypasses RLS. Enabled with no policies so
-- the tables are not reachable if PostgREST is ever exposed publicly.
-- (architecture/README.md, decision D2.)
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
