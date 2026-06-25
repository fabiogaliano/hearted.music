/**
 * Match strictness — the read-time quality bar.
 *
 * A per-user preference that hides weak matches at read time. The scoring
 * pipeline and `match_result` writes are untouched (they still use the
 * write-time `minScoreThreshold` in config.ts), so changing the preset is
 * instant and fully reversible. We store the preset *name* in the database and
 * keep the preset→score mapping here in code, so the thresholds can be retuned
 * later without a data migration.
 *
 * Server-importable: holds only the enum + numeric mapping. The voice-guided UI
 * labels/descriptions live with the settings component.
 */

export const MATCH_STRICTNESS_VALUES = ["open", "balanced", "strict"] as const;
export type MatchStrictness = (typeof MATCH_STRICTNESS_VALUES)[number];

export const DEFAULT_MATCH_STRICTNESS: MatchStrictness = "balanced";

export const STRICTNESS_MIN_SCORE: Record<MatchStrictness, number> = {
	open: 0.35, // = write-time floor, shows everything stored
	balanced: 0.5,
	strict: 0.65,
};

/**
 * The single source of truth for strictness comparison and match-percent
 * display (E7, A5, I1).
 *
 * fused_score is the pre-rerank weighted-sum — the authoritative quality
 * signal set at write time and never overwritten by the reranker. score is
 * the legacy ordering field that may hold the reranked value on rows written
 * before match_result_ranking existed; we fall back to it only when
 * fused_score is absent.
 *
 * No read path should compare against the reranker/ordering score for
 * strictness or display — callers must go through this helper.
 */
export function strictnessScore(row: {
	score: number;
	fused_score: number | null;
}): number {
	return row.fused_score ?? row.score;
}
