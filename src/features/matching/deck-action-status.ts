import type { MatchDeckAction } from "@/lib/server/match-deck.functions";

/**
 * Per-action success-token classifier for submitMatchDeckAction's raw
 * actionStatus (RA). The four deck action RPCs keep RETURNS TEXT (Phase 1b/3), so
 * the route can't read a boolean off the wire — it must know, per action type,
 * which status tokens mean "the write landed" versus "rejected: do not advance /
 * roll back the optimistic surgery".
 *
 * Tokens are enumerated verbatim from the four atomic status sets in
 * match-review-queue/queries.ts (ADD_QUEUE_ITEM_DECISION_ATOMIC_STATUSES,
 * DISMISS_QUEUE_ITEM_SUGGESTION_ATOMIC_STATUSES, FINISH_QUEUE_ITEM_ATOMIC_STATUSES,
 * DISMISS_QUEUE_ITEM_ATOMIC_STATUSES). Mis-classifying either way is a UX bug (a
 * silent no-op that still advances, or a successful write that rolls back), so the
 * success sets are enumerated explicitly rather than derived.
 */
type MatchDeckActionType = MatchDeckAction["type"];

const SUCCESS_TOKENS: Record<MatchDeckActionType, ReadonlySet<string>> = {
	// add_match_review_item_decision_atomic → "added" once the decision row lands.
	"add-suggestion": new Set(["added"]),
	// dismiss_match_review_item_suggestion_atomic → "dismissed" on the written row.
	"dismiss-suggestion": new Set(["dismissed"]),
	// finish_match_review_item_atomic → "completed_added" (had adds) | "skipped" (none).
	"finish-card": new Set(["completed_added", "skipped"]),
	// dismiss_match_review_item_atomic → "dismissed" once the item resolves.
	"dismiss-card": new Set(["dismissed"]),
};

/**
 * True when `actionStatus` is a success token for `type`. Everything else — a
 * rejection (already_resolved, not_visible, no_captured_pairs, invalid_target, …)
 * or an unrecognised token — is treated as not-success: the caller must not
 * advance the card, and any optimistic cache surgery must roll back.
 */
export function isDeckActionSuccess(
	type: MatchDeckActionType,
	actionStatus: string,
): boolean {
	return SUCCESS_TOKENS[type].has(actionStatus);
}
