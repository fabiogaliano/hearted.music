-- Drop the global UNIQUE(snapshot_hash) constraint on match_snapshot.
--
-- The constraint dates from the original match_context design (20260117000008),
-- where context_hash was a global identity: computed once, stored once. The
-- dedup redesign (20260320180000) changed the hash's meaning to a
-- dedup-against-latest-per-account signal — publish_match_snapshot no-ops only
-- when the new hash equals the account's LATEST snapshot, and deliberately
-- re-inserts a historical hash on A -> B -> A state reversion so the reverted
-- state becomes the latest row again (the app reads by created_at DESC).
-- That migration never reconciled the constraint, so any real reversion makes
-- the INSERT collide: "duplicate key value violates unique constraint
-- match_snapshot_snapshot_hash_key" (prod incident 2026-06-12).
--
-- The constraint also breaks writeEmptySnapshot independently: it uses the
-- constant hash 'empty_target_playlist_snapshot' for every account, so under a
-- GLOBAL unique only one account in the system could ever publish an empty
-- snapshot.
--
-- No replacement constraint: UNIQUE(account_id, snapshot_hash) would equally
-- break the A -> B -> A case. No read path looks rows up by hash expecting
-- uniqueness — reads go by account_id + created_at DESC via
-- idx_match_snapshot_latest. The non-unique idx_match_snapshot_hash remains
-- for hash lookups.
--
-- IF EXISTS keeps this idempotent in case the constraint was already dropped
-- ad hoc during incident response.

ALTER TABLE match_snapshot
  DROP CONSTRAINT IF EXISTS match_snapshot_snapshot_hash_key;
