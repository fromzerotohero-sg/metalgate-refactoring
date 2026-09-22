-- Migration: Create deduct_credits RPC function for atomic operations
-- Run this in your Supabase SQL Editor

CREATE OR REPLACE FUNCTION deduct_credits(p_user_id UUID, p_amount INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_bal INT;
  new_bal INT;
BEGIN
  -- Lock the user row for update to prevent race conditions
  SELECT credits_balance INTO current_bal 
  FROM users 
  WHERE id = p_user_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'User not found');
  END IF;

  IF current_bal < p_amount THEN
    RETURN json_build_object('success', FALSE, 'error', 'Insufficient credits');
  END IF;

  new_bal := current_bal - p_amount;
  
  UPDATE users 
  SET credits_balance = new_bal 
  WHERE id = p_user_id;

  RETURN json_build_object('success', TRUE, 'new_balance', new_bal);
END;
$$;

CREATE OR REPLACE FUNCTION add_credits(p_user_id UUID, p_amount INT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_bal INT;
  new_bal INT;
BEGIN
  -- Lock the user row for update to prevent race conditions
  SELECT credits_balance INTO current_bal 
  FROM users 
  WHERE id = p_user_id 
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', FALSE, 'error', 'User not found');
  END IF;

  new_bal := current_bal + p_amount;
  
  UPDATE users 
  SET credits_balance = new_bal 
  WHERE id = p_user_id;

  RETURN json_build_object('success', TRUE, 'new_balance', new_bal);
END;
$$;

-- Create email_verifications table for Metalgate SSO
CREATE TABLE IF NOT EXISTS public.email_verifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    used_at TIMESTAMP WITH TIME ZONE,
    
    -- Constraints
    CONSTRAINT email_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_verifications_token ON public.email_verifications(token);
CREATE INDEX IF NOT EXISTS idx_email_verifications_user_id ON public.email_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verifications_expires_at ON public.email_verifications(expires_at);

-- Add email_verified column to users table if it doesn't exist
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- Create index for email_verified
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON public.users(email_verified);

-- Row Level Security (RLS) policies
ALTER TABLE public.email_verifications ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own verification tokens
DROP POLICY IF EXISTS "Users can view own email verifications" ON public.email_verifications;
CREATE POLICY "Users can view own email verifications" ON public.email_verifications
    FOR SELECT USING (auth.uid()::text = user_id::text);

-- Policy: Users can insert their own verification tokens
DROP POLICY IF EXISTS "Users can insert own email verifications" ON public.email_verifications;
CREATE POLICY "Users can insert own email verifications" ON public.email_verifications
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- Policy: Service role can manage all verifications
DROP POLICY IF EXISTS "Service role full access to email verifications" ON public.email_verifications;
CREATE POLICY "Service role full access to email verifications" ON public.email_verifications
    FOR ALL USING (auth.role() = 'service_role');

-- Grant permissions
GRANT ALL ON public.email_verifications TO authenticated;
GRANT ALL ON public.email_verifications TO service_role;
GRANT SELECT ON public.email_verifications TO anon;
