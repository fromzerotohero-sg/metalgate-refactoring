-- Create Streamers table
CREATE TABLE IF NOT EXISTS public.streamers (
    streamer_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    is_managed BOOLEAN DEFAULT FALSE,
    manager_id UUID REFERENCES public.streamers(streamer_id),
    referred_num INTEGER DEFAULT 0,
    balance_available NUMERIC(10, 2) DEFAULT 0,
    total_earned NUMERIC(10, 2) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create Percentages table
CREATE TABLE IF NOT EXISTS public.perc (
    id SERIAL PRIMARY KEY,
    to_streamer NUMERIC(5, 2) NOT NULL,
    to_manager NUMERIC(5, 2) NOT NULL
);

-- Insert default percentages (e.g. 10% streamer, 5% manager)
INSERT INTO public.perc (id, to_streamer, to_manager) 
VALUES (1, 10.00, 5.00) 
ON CONFLICT (id) DO UPDATE SET to_streamer = EXCLUDED.to_streamer, to_manager = EXCLUDED.to_manager;

-- Create Credentials table
CREATE TABLE IF NOT EXISTS public.credentials (
    id_code VARCHAR(50) PRIMARY KEY,
    streamer_id UUID REFERENCES public.streamers(streamer_id)
);

-- Add streamer referral tracking to users
-- Note: We use DO block to avoid errors if columns already exist
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'referred_by_streamer') THEN 
        ALTER TABLE public.users ADD COLUMN referred_by_streamer UUID REFERENCES public.streamers(streamer_id); 
    END IF; 

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'has_purchased') THEN 
        ALTER TABLE public.users ADD COLUMN has_purchased BOOLEAN DEFAULT FALSE; 
    END IF; 
END $$;

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Function to handle successful purchase and referral credits recursively
-- Dropping first to handle type change if it exists
DROP FUNCTION IF EXISTS process_referral_purchase(BIGINT, NUMERIC);
DROP FUNCTION IF EXISTS process_referral_purchase(UUID, NUMERIC);
DROP FUNCTION IF EXISTS process_referral_purchase(UUID, NUMERIC, INTEGER);

CREATE OR REPLACE FUNCTION process_referral_purchase(
    p_user_id UUID,
    p_amount_paid NUMERIC,
    p_base_credits INTEGER DEFAULT 250
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_record RECORD;
    v_streamer_id UUID;
    v_current_streamer_id UUID;
    v_manager_id UUID;
    v_to_streamer_perc NUMERIC;
    v_to_manager_perc NUMERIC;
    v_streamer_reward NUMERIC;
    v_manager_reward NUMERIC;
    v_credits_to_add INT;
    v_was_referred BOOLEAN;
    v_is_managed BOOLEAN;
BEGIN
    -- 1. Get user details
    SELECT * INTO v_user_record FROM public.users WHERE id = p_user_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', FALSE, 'error', 'User not found');
    END IF;

    -- Default credits to add
    v_credits_to_add := p_base_credits;
    v_was_referred := FALSE;
    
    -- Check if user was referred by a streamer
    -- Ensure referred_by_streamer column exists in users table (added by referral_schema.sql)
    v_streamer_id := v_user_record.referred_by_streamer;
    
    IF v_streamer_id IS NOT NULL THEN
        
        -- Check if it's the first purchase (has_purchased is false or null)
        IF COALESCE(v_user_record.has_purchased, FALSE) = FALSE THEN
            -- It's a first purchase from a referred user
            -- "300 crediti invece di 250" implies a +50 bonus
            v_credits_to_add := p_base_credits + 50;
            v_was_referred := TRUE;
            
            -- Update user to mark has_purchased = true
            UPDATE public.users SET has_purchased = TRUE WHERE id = p_user_id;
        END IF;
        
        -- Get percentages
        SELECT to_streamer, to_manager INTO v_to_streamer_perc, v_to_manager_perc FROM public.perc LIMIT 1;
        
        IF v_to_streamer_perc IS NULL OR v_to_manager_perc IS NULL THEN
            v_to_streamer_perc := 10.00;
            v_to_manager_perc := 5.00;
        END IF;

        -- Calculate initial streamer reward
        v_streamer_reward := p_amount_paid * (v_to_streamer_perc / 100.0);
        
        -- Add reward to initial streamer
        UPDATE public.streamers 
        SET balance_available = balance_available + v_streamer_reward,
            total_earned = total_earned + v_streamer_reward
        WHERE streamer_id = v_streamer_id;
        
        -- Start recursive manager rewards
        v_current_streamer_id := v_streamer_id;
        
        LOOP
            -- Get manager of current streamer
            SELECT manager_id, is_managed INTO v_manager_id, v_is_managed
            FROM public.streamers 
            WHERE streamer_id = v_current_streamer_id;
            
            -- Exit loop if no manager or not managed
            EXIT WHEN v_manager_id IS NULL OR v_is_managed = FALSE;
            
            -- Calculate manager reward (using the same manager percentage each step up the chain)
            v_manager_reward := p_amount_paid * (v_to_manager_perc / 100.0);
            
            -- Add reward to manager
            UPDATE public.streamers 
            SET balance_available = balance_available + v_manager_reward,
                total_earned = total_earned + v_manager_reward
            WHERE streamer_id = v_manager_id;
            
            -- Move up the chain
            v_current_streamer_id := v_manager_id;
        END LOOP;
        
    END IF;
    
    -- Add credits to user
    UPDATE public.users 
    SET credits_balance = credits_balance + v_credits_to_add 
    WHERE id = p_user_id;
    
    RETURN json_build_object(
        'success', TRUE, 
        'credits_added', v_credits_to_add, 
        'was_referred', v_was_referred,
        'streamer_id', v_streamer_id
    );
END;
$$;
