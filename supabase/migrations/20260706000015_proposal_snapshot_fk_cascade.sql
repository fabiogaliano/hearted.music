-- Deck read model fix (review M13b): match_review_proposal.snapshot_id had no
-- ON DELETE clause (20260706000003:26-28), which defaults to RESTRICT. That
-- silently changes delete behavior on the legacy match_snapshot table:
-- integration tests already delete match_snapshot rows directly, and any such
-- delete now fails once a proposal has been built off that snapshot.
--
-- Proposals are derived data with no audit value outliving their snapshot
-- (the same reasoning match_review_queue_item.source_snapshot_id deliberately
-- did NOT apply to — that table intentionally keeps history — but a proposal
-- is a rebuildable cache, not a record of what a user was shown). Switch the
-- FK to ON DELETE CASCADE: deleting a snapshot now cleans up any proposal (and
-- via existing ON DELETE CASCADE on proposal_id, its subject/seed rows) built
-- from it.
--
-- Constraint name confirmed via pg_constraint (auto-named — no explicit name
-- was given in the CREATE TABLE):
--   match_review_proposal_snapshot_id_fkey.

ALTER TABLE public.match_review_proposal
  DROP CONSTRAINT match_review_proposal_snapshot_id_fkey,
  ADD CONSTRAINT match_review_proposal_snapshot_id_fkey
    FOREIGN KEY (snapshot_id) REFERENCES public.match_snapshot(id) ON DELETE CASCADE;
