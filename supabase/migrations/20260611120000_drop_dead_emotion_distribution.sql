-- Drop the dead emotion_distribution column on playlist_profile.
--
-- It was created with the table but never carried data: emotion analysis is
-- disabled (the model bundle's emotionEnabled flag was always false), so every
-- profile persisted it as {} and nothing ever read it. Removing the column,
-- its write sites, and the emotionEnabled flag together (matching-system
-- roadmap #7 dead-field cleanup).
ALTER TABLE playlist_profile DROP COLUMN IF EXISTS emotion_distribution;
