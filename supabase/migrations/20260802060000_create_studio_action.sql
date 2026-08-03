-- Append-only Studio feedback events. Unlike match_decision, this records each
-- pre-publish action without a uniqueness constraint so repeated sessions remain
-- available for future interpretation.
CREATE TABLE public.studio_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES public.account(id) ON DELETE CASCADE,
  song_id UUID NOT NULL REFERENCES public.song(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('add', 'pin', 'remove', 'dismiss')),
  position INTEGER,
  context JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_studio_action_account ON public.studio_action(account_id);
CREATE INDEX idx_studio_action_account_song
  ON public.studio_action(account_id, song_id);
CREATE INDEX idx_studio_action_session ON public.studio_action(session_id);

ALTER TABLE public.studio_action ENABLE ROW LEVEL SECURITY;

CREATE POLICY "studio_action_deny_all"
  ON public.studio_action
  FOR ALL
  USING (false);
