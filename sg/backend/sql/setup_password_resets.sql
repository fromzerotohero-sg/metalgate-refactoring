-- Create password_resets table
CREATE TABLE IF NOT EXISTS public.password_resets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    used_at TIMESTAMP WITH TIME ZONE
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_password_resets_code ON public.password_resets(code);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON public.password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires_at ON public.password_resets(expires_at);

-- RLS Policies
ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;

-- Service role full access
DROP POLICY IF EXISTS "Service role full access to password_resets" ON public.password_resets;
CREATE POLICY "Service role full access to password_resets" ON public.password_resets
    FOR ALL USING (auth.role() = 'service_role');

-- Grant permissions
GRANT ALL ON public.password_resets TO service_role;
GRANT SELECT ON public.password_resets TO anon;
GRANT ALL ON public.password_resets TO authenticated;
