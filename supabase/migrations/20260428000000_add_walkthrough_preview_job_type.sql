-- Walkthrough match preview is an onboarding-only background job that scores
-- a chosen demo song against the user's selected target playlists. It runs on
-- the worker but is intentionally disjoint from the library-processing claim
-- path so its results never leak into match_snapshot / match_result.

ALTER TYPE job_type ADD VALUE IF NOT EXISTS 'walkthrough_match_preview';
