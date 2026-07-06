-- Match deck read model, Phase 1a (plan §5.1): proposal storage.
--
-- A proposal is a write-time, sessionless, ordered review-subject list for one
-- (account, orientation, snapshot, visibility_config_hash). It never creates
-- sessions, queue items, or visible-pair rows (that happens at promotion,
-- Phase 1b). Full per-orientation pair order already lives in
-- match_result_ranking; the seed table below is intentionally window-bounded
-- (first few subjects only) so it does not duplicate that table.
--
-- All three tables follow the house RLS convention: ENABLE ROW LEVEL SECURITY
-- + an explicit deny-all policy. service_role access comes from the
-- ALTER DEFAULT PRIVILEGES grant already in place (20260613030000), so no
-- table-level REVOKE/GRANT is needed here (mirrors match_review_session).

-- ---------------------------------------------------------------------------
-- match_review_proposal
-- ---------------------------------------------------------------------------

CREATE TABLE public.match_review_proposal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  orientation TEXT NOT NULL CHECK (orientation IN ('song', 'playlist')),
  -- No ON DELETE: mirrors match_review_queue_item.source_snapshot_id — a
  -- snapshot referenced by a built proposal must not disappear out from under
  -- it. Snapshots are append-only in practice; this is a structural guard.
  snapshot_id UUID NOT NULL REFERENCES match_snapshot(id),
  -- The existing visibility-policy hash (vc_<orientation>_<minScore>_<rtfHash>,
  -- src/lib/domains/taste/match-review-queue/visibility-policy.ts). Reused
  -- verbatim as the proposal key — no new policy_hash concept.
  visibility_config_hash TEXT NOT NULL,
  strictness_preset TEXT NOT NULL,
  strictness_min_score DOUBLE PRECISION NOT NULL,
  -- Component hash of the read-time filters folded into visibility_config_hash
  -- (e.g. UTC-today liked-at folding). Kept separately so a midnight rollover
  -- that changes this hash but not the rest is diagnosable without recomputing
  -- the composite hash.
  read_time_filters_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building'
    CHECK (status IN ('building', 'ready', 'stale', 'failed')),
  total_subjects INTEGER NOT NULL DEFAULT 0,
  hidden_review_item_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One proposal per policy per snapshot per orientation; a repeat build
  -- (repair, warm script) upserts onto this key instead of duplicating rows.
  UNIQUE (account_id, orientation, snapshot_id, visibility_config_hash)
);

-- Read-path lookup: "does a ready proposal exist for this account+orientation
-- under the current policy" is the hot query the start/resume RPC will run.
CREATE INDEX idx_match_review_proposal_account_orientation_status
  ON public.match_review_proposal (account_id, orientation, status);

-- FK column has no automatic index; snapshot-triggered rebuilds (publish,
-- repair) look proposals up by snapshot_id.
CREATE INDEX idx_match_review_proposal_snapshot
  ON public.match_review_proposal (snapshot_id);

ALTER TABLE public.match_review_proposal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "match_review_proposal_deny_all"
  ON public.match_review_proposal FOR ALL USING (false);

CREATE TRIGGER match_review_proposal_updated_at
  BEFORE UPDATE ON public.match_review_proposal
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- match_review_proposal_subject
-- ---------------------------------------------------------------------------
-- Ordered review subjects for a proposal. Mirrors match_review_queue_item's
-- exactly-one-subject shape so proposal order and queue insertion agree by
-- construction (plan §6: promotion is a bulk INSERT … SELECT from this table).

CREATE TABLE public.match_review_proposal_subject (
  proposal_id UUID NOT NULL
    REFERENCES public.match_review_proposal(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  orientation TEXT NOT NULL CHECK (orientation IN ('song', 'playlist')),
  song_id UUID REFERENCES song(id) ON DELETE CASCADE,
  playlist_id UUID REFERENCES playlist(id) ON DELETE CASCADE,
  source_fit_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  was_new_at_enqueue BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (proposal_id, position),
  -- Exactly-one-subject, mirroring match_review_queue_item_exactly_one_subject.
  CONSTRAINT match_review_proposal_subject_exactly_one_subject CHECK (
    (orientation = 'song'     AND song_id     IS NOT NULL AND playlist_id IS NULL) OR
    (orientation = 'playlist' AND playlist_id IS NOT NULL AND song_id     IS NULL)
  )
);

ALTER TABLE public.match_review_proposal_subject ENABLE ROW LEVEL SECURITY;
CREATE POLICY "match_review_proposal_subject_deny_all"
  ON public.match_review_proposal_subject FOR ALL USING (false);

-- ---------------------------------------------------------------------------
-- match_review_proposal_seed_pair
-- ---------------------------------------------------------------------------
-- Window-bounded promotion seed: pre-filtered visible pairs for only the first
-- PROMOTION_SEED_SUBJECTS subjects (a few hundred rows per proposal, not full
-- pair order — that already lives in match_result_ranking). Promotion copies
-- these rows into match_review_item_visible_pair, re-checking match_decision
-- exclusions in SQL (same pattern as present_match_review_item_fast).

CREATE TABLE public.match_review_proposal_seed_pair (
  proposal_id UUID NOT NULL
    REFERENCES public.match_review_proposal(id) ON DELETE CASCADE,
  subject_position INTEGER NOT NULL,
  song_id UUID NOT NULL REFERENCES song(id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlist(id) ON DELETE CASCADE,
  fit_score DOUBLE PRECISION NOT NULL,
  model_rank INTEGER NOT NULL,
  visible_rank INTEGER NOT NULL,
  PRIMARY KEY (proposal_id, subject_position, song_id, playlist_id),
  -- Ties every seed pair to a real subject row at the same position so a
  -- proposal can never carry orphaned seed rows.
  CONSTRAINT match_review_proposal_seed_pair_subject_fkey
    FOREIGN KEY (proposal_id, subject_position)
    REFERENCES public.match_review_proposal_subject (proposal_id, position)
    ON DELETE CASCADE
);

-- PK already leads with (proposal_id, subject_position), which is the only
-- index the plan calls for (window-bounded — no uniqueness beyond this).

ALTER TABLE public.match_review_proposal_seed_pair ENABLE ROW LEVEL SECURITY;
CREATE POLICY "match_review_proposal_seed_pair_deny_all"
  ON public.match_review_proposal_seed_pair FOR ALL USING (false);
