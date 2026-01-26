-- Create waitlist table for landing page email signups
-- Uses bigint identity for better insert performance (no UUID fragmentation)
CREATE TABLE IF NOT EXISTS public.waitlist (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Note: UNIQUE on email already creates an index, no need for explicit index
-- Note: updated_at removed since waitlist rows are insert-only

-- Enable RLS
ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Only service role can insert (from server functions, not direct client calls)
-- Frontend bots would need to go through your rate-limited API endpoint
CREATE POLICY "Service role can insert waitlist entries"
  ON public.waitlist
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Only service role can read emails (protects user privacy)
CREATE POLICY "Service role can read waitlist"
  ON public.waitlist
  FOR SELECT
  TO service_role
  USING (true);
