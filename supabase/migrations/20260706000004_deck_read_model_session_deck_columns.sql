-- Match deck read model, Phase 1a (plan §5.2): deck state as columns on
-- match_review_session — no new deck table. match_review_queue_item remains
-- the timeline of record; these columns are the session's read-model head.

ALTER TABLE public.match_review_session
  ADD COLUMN active_proposal_id UUID
    REFERENCES public.match_review_proposal(id) ON DELETE SET NULL;

-- Bumped by every deck-mutating action (add/dismiss/finish/dismiss-card).
-- Stale-revision requests are answered with the current view, so the default
-- of 0 is simply "no actions have mutated this deck yet".
ALTER TABLE public.match_review_session
  ADD COLUMN deck_revision INTEGER NOT NULL DEFAULT 0;

-- Authoritative "resume here" pointer; client-side Previous/Next browsing
-- never touches it, only decisions advance it. NULL means "not yet
-- positioned by a promotion/resume" — distinct from a real position value, so
-- Phase 1b's start/resume RPC can tell "never opened" apart from "opened and
-- sitting at position 0" without relying on a sentinel integer.
ALTER TABLE public.match_review_session
  ADD COLUMN resume_position INTEGER;

CREATE INDEX idx_match_review_session_active_proposal
  ON public.match_review_session (active_proposal_id)
  WHERE active_proposal_id IS NOT NULL;
