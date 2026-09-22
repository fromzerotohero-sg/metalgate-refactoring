-- Change temp_credits_balance from INTEGER to JSONB on users and tempusers.
-- Each entry in the array: { "amount": <int>, "expires_at": "<ISO-8601 UTC>" }
-- All expiry logic is handled in the Python backend.
--
-- NOTE: ALTER COLUMN is required because ADD COLUMN IF NOT EXISTS is a no-op
-- when the column already exists (even with a different type).

ALTER TABLE public.users
ALTER COLUMN temp_credits_balance TYPE JSONB
USING '[]'::jsonb;

ALTER TABLE public.users
ALTER COLUMN temp_credits_balance SET DEFAULT '[]'::jsonb;

ALTER TABLE public.tempusers
ALTER COLUMN temp_credits_balance TYPE JSONB
USING '[]'::jsonb;

ALTER TABLE public.tempusers
ALTER COLUMN temp_credits_balance SET DEFAULT '[]'::jsonb;
