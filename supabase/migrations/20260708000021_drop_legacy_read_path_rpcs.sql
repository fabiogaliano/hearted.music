-- Deck read-model cleanup: drop the pre-deck read-path RPCs.
--
-- resume_match_review_session (20260706000001) and present_match_review_item_fast
-- (20260706000002) were the old /match read path: consolidated resume and the
-- playlist-card fast read. The deck read model superseded both —
-- start_or_resume_match_deck returns the whole MatchDeckView in one round trip
-- and read_match_deck_card generalizes the fast read to both orientations. The
-- TypeScript wrappers (callResumeMatchReviewSession, callPresentMatchReviewItemFast)
-- are gone and nothing else references these functions. Prod has soaked on the
-- deck path; dropping them removes dead SECURITY DEFINER surface.
DROP FUNCTION IF EXISTS public.resume_match_review_session(UUID, TEXT);
DROP FUNCTION IF EXISTS public.present_match_review_item_fast(UUID, UUID, INTEGER);
