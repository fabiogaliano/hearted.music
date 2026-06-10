-- Prevent duplicate active extension syncs per account.
-- The extension sync route gates on a plain getActiveSync() SELECT, which is
-- racy: two simultaneous requests both read "no active sync," both create a
-- full set of phase jobs, and both fire applyLibraryProcessingChange --
-- duplicate enrichment work and queue inflation.
--
-- sync_liked_songs is the lock sentinel: it is always created, and created
-- first, for every sync. This partial unique index makes the database the
-- single source of truth for "one active sync at a time," exactly as
-- idx_unique_active_enrichment_per_account does for enrichment chains. The
-- losing concurrent insert surfaces as 23505, which the route maps to the
-- existing "sync already running" 429.
--
-- The index covers only sync_liked_songs (not all three sync types) because a
-- single sync legitimately holds three active job rows for one account; a
-- predicate spanning all of them would collide with itself on the first sync.

CREATE UNIQUE INDEX idx_unique_active_sync_per_account
  ON job (account_id)
  WHERE type = 'sync_liked_songs' AND status IN ('pending', 'running');
