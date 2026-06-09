-- Persist the outcome of the post-generation voice rewrite pass
-- (src/lib/domains/enrichment/content-analysis/voice/rewrite-pass.ts) on each analysis row.
-- The pass recasts HIGH-severity AI-tell constructions in a lyrical read; its result was
-- previously discarded, so prod cleanup efficacy could only be re-derived offline. These
-- columns make it queryable directly (e.g. how many rows still carry residual tells).
--
-- Additive, nullable, no default, no backfill -> metadata-only change, no table rewrite.
-- All four stay NULL for instrumental analyses, which skip the rewrite entirely:
-- NULL = "no rewrite applied", kept distinct from 0 = "ran and found nothing".

ALTER TABLE song_analysis
  ADD COLUMN cleanup_passes       INTEGER,
  ADD COLUMN cleanup_tells_before INTEGER,
  ADD COLUMN cleanup_tells_after  INTEGER,
  ADD COLUMN cleanup_error        TEXT;

COMMENT ON COLUMN song_analysis.cleanup_passes IS
  'Voice rewrite passes that ran: 0 = read was already clean, NULL = instrumental (no rewrite)';
COMMENT ON COLUMN song_analysis.cleanup_tells_before IS
  'Count of the HIGH-severity prose AI-tells the rewrite targets, present before the pass';
COMMENT ON COLUMN song_analysis.cleanup_tells_after IS
  'Count of those targeted AI-tells still present after the pass (residual); ideally 0';
COMMENT ON COLUMN song_analysis.cleanup_error IS
  'Rewrite LLM error when the pass failed and the raw read was stored unchanged; NULL on success';
