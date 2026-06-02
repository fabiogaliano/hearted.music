-- Waitlist eligibility matches accounts on normalized email (lower + trim), so
-- raw-text uniqueness lets case/whitespace variants of the same address slip in
-- as separate rows. Collapse existing collisions (keeping the earliest row per
-- normalized email) and enforce normalization at the index level going forward.

-- 1. Dedupe: delete every row that has an earlier sibling sharing its normalized
--    email. Earliest = smallest created_at, tie-broken by smallest id (identity
--    insert order), so the surviving row is the first signup.
DELETE FROM waitlist AS dup
USING waitlist AS keep
WHERE lower(btrim(dup.email)) = lower(btrim(keep.email))
  AND (
    keep.created_at < dup.created_at
    OR (keep.created_at = dup.created_at AND keep.id < dup.id)
  );

-- 2. Drop the raw-text unique constraint (auto-named from the inline UNIQUE).
ALTER TABLE waitlist DROP CONSTRAINT waitlist_email_key;

-- 3. Enforce uniqueness on the normalized email instead.
CREATE UNIQUE INDEX waitlist_email_normalized_key
  ON waitlist (lower(btrim(email)));
