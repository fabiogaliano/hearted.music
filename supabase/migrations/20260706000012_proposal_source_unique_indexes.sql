-- Deck read model fix (review H3, part a): unique indexes on the proposal
-- SOURCE tables so malformed worker-derived rows fail at BUILD time (worker
-- retries, nobody waiting) instead of at promotion time (start_or_resume_match_deck,
-- a hard 500 on a request path).
--
-- match_review_proposal_subject stores subjects for BOTH orientations in one
-- table (song subjects carry song_id, playlist subjects carry playlist_id; the
-- exactly-one-subject CHECK from 20260706000003 already enforces which). A
-- proposal must not carry the same subject twice — mirrors the target table's
-- idx_match_review_queue_item_session_song_subject /
-- idx_match_review_queue_item_session_playlist_subject partial uniqueness
-- (20260625010000), which this table was missing.
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_review_proposal_subject_song_identity
  ON public.match_review_proposal_subject (proposal_id, song_id)
  WHERE song_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_match_review_proposal_subject_playlist_identity
  ON public.match_review_proposal_subject (proposal_id, playlist_id)
  WHERE playlist_id IS NOT NULL;

-- match_review_proposal_seed_pair's PK leads with (proposal_id, subject_position)
-- but is completed by (song_id, playlist_id), so it does not prevent two seed
-- rows for the same subject from claiming the same visible_rank — the
-- invariant capture_match_review_item_visible_pairs_atomic already validates
-- (dense, duplicate-free ranks) before writing the same target column
-- (idx_match_review_item_visible_pair_queue_visible_rank, 20260625040000).
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_review_proposal_seed_pair_position_rank
  ON public.match_review_proposal_seed_pair (proposal_id, subject_position, visible_rank);
