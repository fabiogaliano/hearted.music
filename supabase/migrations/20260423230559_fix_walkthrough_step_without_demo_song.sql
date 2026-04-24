-- Backfill: rows with a walkthrough step but no demo_song_id are impossible
-- after the atomic `commitDemoSongAndEnterWalkthrough` transition lands.
-- Any row in this state predates the fix and would cause an onboarding
-- redirect loop between /onboarding?step=pick-demo-song and /liked-songs.
-- Reset those rows back to pick-demo-song so the user resumes cleanly.

UPDATE user_preferences
SET onboarding_step = 'pick-demo-song'
WHERE onboarding_step IN ('song-walkthrough', 'match-walkthrough')
  AND demo_song_id IS NULL;
