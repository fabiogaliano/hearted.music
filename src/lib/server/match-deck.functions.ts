/**
 * Phase 3 server contracts for the Match deck read model (plan §4/§7/§8/§9).
 *
 * The public deck contract lives in match-review-queue/deck-view.ts; this file
 * holds its three server fns:
 *   - startOrResumeMatchDeck — one bounded /match-entry call (plan §8). Active →
 *     the full MatchDeckView; miss + snapshot → approach-X first-window build
 *     (R-B); miss + no snapshot → the building empty state.
 *   - readMatchDeckCard — a pure card read with an on-demand materialize fallback
 *     for the not-yet-captured cold path (R-E).
 *   - submitMatchDeckAction — dispatch to the existing atomic domain wrappers
 *     (they already do the deck side effects in-txn and keep RETURNS TEXT), then
 *     read the fresh view (R-A: read-after-write, no return-type migration).
 *
 * This ships ALONGSIDE the legacy query families; nothing legacy is deleted here
 * (that is Phase 4/5). New RPCs are typed via the deck escape hatch until
 * `bun run gen:types` runs.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { captureAheadForSession } from "@/lib/domains/taste/match-review-queue/card-materializer";
import { SONG_CARD_SUGGESTION_CAP } from "@/lib/domains/taste/match-review-queue/card-suggestion-caps";
import {
	activeDeckOrNull,
	callReadMatchDeckCard,
	callStartOrResumeMatchDeck,
} from "@/lib/domains/taste/match-review-queue/deck-read-queries";
import {
	captureUnexpectedCardShape,
	deckWindow,
	type MatchDeckView,
	type MatchReviewItemRead,
	mapReadDeckCardToItemRead,
	mapStartOrResumeToView,
	type StartOrResumeMatchDeckResult,
	type SubmitMatchDeckActionResult,
} from "@/lib/domains/taste/match-review-queue/deck-view";
import {
	addQueueItemDecisionAtomically,
	dismissQueueItemAtomically,
	dismissQueueItemSuggestionAtomically,
	finishQueueItemAtomically,
	mapItemToDto,
} from "@/lib/domains/taste/match-review-queue/queries";
import {
	type MatchOrientation,
	MatchOrientationSchema,
	type MatchReviewQueueItemDto,
} from "@/lib/domains/taste/match-review-queue/types";
import { resolveVisibilityConfigHash } from "@/lib/domains/taste/match-review-queue/visibility-config-hash";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import {
	DEFAULT_MATCH_STRICTNESS,
	STRICTNESS_MIN_SCORE,
} from "@/lib/domains/taste/song-matching/strictness";
import { captureProductEventBestEffort } from "@/lib/observability/capture-product-event";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { buildFirstWindowAndPromote } from "./match-deck-miss-path";

// ============================================================================
// Small helpers
// ============================================================================

function reportDeckError(
	error: unknown,
	operation: string,
	accountId: string,
	extra?: Record<string, unknown>,
): void {
	captureServerError(error, {
		area: "match_review_queue",
		operation,
		accountId,
		extra,
	});
}

function narrowOrientation(value: unknown): MatchOrientation | null {
	return MatchOrientationSchema.safeParse(value).data ?? null;
}

/**
 * Deck entry hit — start_or_resume resolved to a live view, either directly
 * active or via the miss-path promotion. `source` distinguishes the two so the
 * hit-rate dashboard can separate warm hits from self-heals. Best-effort.
 */
function captureDeckEntryHit(
	accountId: string,
	orientation: MatchOrientation,
	source: "active" | "promoted",
	view: MatchDeckView,
): void {
	captureProductEventBestEffort({
		distinctId: accountId,
		accountId,
		event: "match_deck_hit",
		operation: "capture_match_deck_hit",
		properties: {
			orientation,
			source,
			revision: view.revision,
			remaining: view.progress.remaining,
		},
	});
}

/**
 * Deck entry miss — start_or_resume could not resolve a live view this request.
 * `reason` separates "no snapshot published yet" (genuinely nothing to show)
 * from "built but still empty/racing" (self-heals on the next entry).
 */
function captureDeckEntryMiss(
	accountId: string,
	orientation: MatchOrientation,
	reason: "no_snapshot" | "promotion_incomplete",
): void {
	captureProductEventBestEffort({
		distinctId: accountId,
		accountId,
		event: "match_deck_miss_reason",
		operation: "capture_match_deck_miss_reason",
		properties: { orientation, reason },
	});
}

/** Reverse the frozen preset↔minScore map (mirrors service.ts:152-154). */
function presetForMinScore(minScore: number): string {
	return (
		Object.entries(STRICTNESS_MIN_SCORE).find(([, v]) => v === minScore)?.[0] ??
		DEFAULT_MATCH_STRICTNESS
	);
}

// ============================================================================
// resolveMatchDeckView — shared by startOrResume + submit (read-after-write)
// ============================================================================

/**
 * The one bounded deck read: compute nowMs → hash (from the SAME target filters
 * a proposal build reads) → call the RPC → map, with the miss branches folded in.
 * On a miss with a published snapshot, the approach-X first-window build runs and
 * re-invokes the RPC; with no snapshot at all, the building empty state.
 *
 * One `nowMs` is threaded into the hash AND (on a miss) buildFirstWindowAndPromote
 * so the RPC's branch-2 search key is byte-identical to the built proposal's hash.
 *
 * `skipHashComputation` (M10): submitMatchDeckAction's read-after-write can only
 * land on the RPC's branch 1 (active session — the action already ran in-txn),
 * which never reads p_visibility_config_hash. In that mode, probe the RPC with a
 * null hash first; branch 1 answers regardless (zero hash cost). Only when the
 * probe reports no active session (the promotion/miss branches, which DO need
 * the hash) do we fall back to computing it and re-calling the RPC properly —
 * a branch that can't happen mid-action in practice, so it's a rare fallback,
 * not the common path.
 */
async function resolveMatchDeckView(
	accountId: string,
	orientation: MatchOrientation,
	// Only a genuine deck ENTRY (startOrResumeMatchDeck) emits hit/miss metrics;
	// submitMatchDeckAction reuses this resolver for its read-after-write and must
	// not double-count entries as hits.
	emitEntryMetrics = false,
	options?: { skipHashComputation?: boolean },
): Promise<StartOrResumeMatchDeckResult> {
	const window = deckWindow(orientation);

	if (options?.skipHashComputation) {
		const probeResult = await callStartOrResumeMatchDeck(
			accountId,
			orientation,
			null,
			window,
		);
		if (Result.isError(probeResult)) {
			reportDeckError(probeResult.error, "resolve_match_deck_view", accountId, {
				orientation,
			});
			throw new Error("Could not load your match deck. Please try again.", {
				cause: probeResult.error,
			});
		}
		const probed = activeDeckOrNull(probeResult.value);
		if (probed && probed.visibilityConfigHash != null) {
			const view = mapStartOrResumeToView(probed, window);
			if (emitEntryMetrics) {
				captureDeckEntryHit(accountId, orientation, "active", view);
			}
			return view;
		}
		// No active session — or a legacy active session whose null-hash probe can't
		// supply visibilityConfigHash — so fall through to the normal path below.
		// A null hash can never satisfy branch 2's exact-match filter, and recomputing
		// the real hash preserves the public contract for the legacy branch-1 case.
	}

	const nowMs = Date.now();
	const hashResult = await resolveVisibilityConfigHash(
		accountId,
		orientation,
		nowMs,
	);
	if (Result.isError(hashResult)) {
		reportDeckError(hashResult.error, "resolve_match_deck_view", accountId, {
			orientation,
		});
		throw new Error("Could not prepare your match deck. Please try again.", {
			cause: hashResult.error,
		});
	}
	const { hash: visibilityConfigHash, minScore } = hashResult.value;
	const preset = presetForMinScore(minScore);

	const rpcResult = await callStartOrResumeMatchDeck(
		accountId,
		orientation,
		visibilityConfigHash,
		window,
	);
	if (Result.isError(rpcResult)) {
		reportDeckError(rpcResult.error, "resolve_match_deck_view", accountId, {
			orientation,
		});
		throw new Error("Could not load your match deck. Please try again.", {
			cause: rpcResult.error,
		});
	}

	const active = activeDeckOrNull(rpcResult.value);
	if (active) {
		const view = mapStartOrResumeToView(active, window);
		if (emitEntryMetrics) {
			captureDeckEntryHit(accountId, orientation, "active", view);
		}
		return view;
	}

	// Miss. Distinguish "no snapshot at all" (building empty state) from
	// "no ready proposal yet" (approach-X first-window build).
	const snapshotResult = await getLatestMatchSnapshot(accountId);
	if (Result.isError(snapshotResult)) {
		reportDeckError(
			snapshotResult.error,
			"resolve_match_deck_view",
			accountId,
			{
				orientation,
			},
		);
		throw new Error("Could not load your match deck. Please try again.", {
			cause: snapshotResult.error,
		});
	}
	if (!snapshotResult.value) {
		if (emitEntryMetrics) {
			captureDeckEntryMiss(accountId, orientation, "no_snapshot");
		}
		return { status: "building" };
	}

	const builtResult = await buildFirstWindowAndPromote({
		accountId,
		orientation,
		snapshotId: snapshotResult.value.id,
		preset,
		minScore,
		visibilityConfigHash,
		nowMs,
		window,
	});
	if (Result.isError(builtResult)) {
		reportDeckError(
			builtResult.error,
			"resolve_match_deck_view_miss",
			accountId,
			{ orientation },
		);
		throw new Error("Could not prepare your match deck. Please try again.", {
			cause: builtResult.error,
		});
	}
	const promoted = activeDeckOrNull(builtResult.value);
	if (promoted) {
		const view = mapStartOrResumeToView(promoted, window);
		if (emitEntryMetrics) {
			captureDeckEntryHit(accountId, orientation, "promoted", view);
		}
		return view;
	}
	// Still a miss right after building (empty subject set / hash race) → building.
	// The enqueued full build makes the next entry a hit.
	if (emitEntryMetrics) {
		captureDeckEntryMiss(accountId, orientation, "promotion_incomplete");
	}
	return { status: "building" };
}

// ============================================================================
// readMatchDeckCard — pure read + on-demand materialize fallback (R-E)
// ============================================================================

/**
 * Loads the owning session/orientation/position for a not-captured card and
 * captures just this one item (reusing captureAheadForSession, window 1) so the
 * re-read finds pairs. Best-effort: a capture failure still lets the re-read
 * surface the not_captured fallback rather than throwing.
 */
async function materializeOnDemand(
	accountId: string,
	itemId: string,
): Promise<{ orientation: MatchOrientation } | null> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("match_review_queue_item")
		.select("session_id, orientation, position")
		.eq("id", itemId)
		.eq("account_id", accountId)
		.maybeSingle();
	if (error) {
		reportDeckError(error, "read_match_deck_card_load_item", accountId, {
			itemId,
		});
		return null;
	}
	if (!data) return null;
	const orientation = narrowOrientation(data.orientation);
	if (!orientation) return null;

	const captureResult = await captureAheadForSession({
		accountId,
		sessionId: data.session_id,
		orientation,
		fromPosition: data.position,
		window: 1,
	});
	if (Result.isError(captureResult)) {
		reportDeckError(
			captureResult.error,
			"read_match_deck_card_materialize",
			accountId,
			{ itemId, orientation },
		);
	}
	return { orientation };
}

async function resolveDeckCard(
	accountId: string,
	itemId: string,
): Promise<MatchReviewItemRead> {
	// Orientation is unknown up front (itemId only), so read the whole capped set
	// (both caps are 100) — never truncates either arm; nextCursor stays null.
	const window = SONG_CARD_SUGGESTION_CAP;

	const firstResult = await callReadMatchDeckCard(
		itemId,
		accountId,
		window,
		true,
	);
	if (Result.isError(firstResult)) {
		reportDeckError(firstResult.error, "read_match_deck_card", accountId, {
			itemId,
		});
		return {
			status: "retryable-error",
			itemId,
			message: "Couldn't load this match card. Try again.",
		};
	}

	const first = firstResult.value;
	captureUnexpectedCardShape(accountId, itemId, first);
	if (first.status !== "not_captured") {
		// Orientation only feeds the no_visible_suggestions copy, and that payload
		// doesn't carry it — null → orientation-neutral copy (never a mislabel).
		return mapReadDeckCardToItemRead(first, itemId, window, null);
	}

	// R-E cold path: worker hasn't captured ahead yet — materialize this one item
	// and re-read ONCE. Still not_captured → the mapper's retryable fallback.
	const materialized = await materializeOnDemand(accountId, itemId);

	let coldResult: MatchReviewItemRead;
	let recovered = false;
	if (!materialized) {
		coldResult = mapReadDeckCardToItemRead(first, itemId, window, null);
	} else {
		const secondResult = await callReadMatchDeckCard(
			itemId,
			accountId,
			window,
			true,
		);
		if (Result.isError(secondResult)) {
			reportDeckError(
				secondResult.error,
				"read_match_deck_card_recapture",
				accountId,
				{ itemId, orientation: materialized.orientation },
			);
			coldResult = {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			};
		} else {
			captureUnexpectedCardShape(accountId, itemId, secondResult.value);
			recovered = secondResult.value.status !== "not_captured";
			// The re-read may now resolve to no_visible_suggestions; materialize gave
			// us the real orientation, so the copy names the correct suggestion side.
			coldResult = mapReadDeckCardToItemRead(
				secondResult.value,
				itemId,
				window,
				materialized.orientation,
			);
		}
	}

	// The on-demand materialize fired (the swiper outran capture-ahead). `recovered`
	// separates a self-heal from a still-cold read. Best-effort.
	captureProductEventBestEffort({
		distinctId: accountId,
		accountId,
		event: "match_deck_materialize_on_read",
		operation: "capture_match_deck_materialize_on_read",
		properties: {
			item_id: itemId,
			recovered,
			orientation: materialized?.orientation ?? null,
		},
	});

	return coldResult;
}

// ============================================================================
// submitMatchDeckAction — read-after-write dispatch (R-A)
// ============================================================================

/**
 * Loads the owned queue item so the suggestion actions can route suggestionId to
 * the orientation-correct column and every action can rebuild the view against
 * the item's orientation. Throws on an operational read failure; returns null for
 * a missing/foreign item.
 */
async function loadOwnedItem(
	accountId: string,
	itemId: string,
): Promise<MatchReviewQueueItemDto | null> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("match_review_queue_item")
		.select("*")
		.eq("id", itemId)
		.eq("account_id", accountId)
		.maybeSingle();
	if (error) {
		reportDeckError(error, "submit_match_deck_action_load_item", accountId, {
			itemId,
		});
		throw new Error("Could not process your action. Please try again.", {
			cause: error,
		});
	}
	return data ? mapItemToDto(data) : null;
}

// ============================================================================
// Server functions
// ============================================================================

const StartMatchDeckSchema = z.object({ orientation: MatchOrientationSchema });

/**
 * The one bounded /match-entry call (plan §8): start or resume the deck for the
 * authed account and return the exact view the route renders, or the building
 * state when no snapshot exists yet.
 */
export const startOrResumeMatchDeck = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => StartMatchDeckSchema.parse(data))
	.handler(async ({ data, context }): Promise<StartOrResumeMatchDeckResult> => {
		return resolveMatchDeckView(
			context.session.accountId,
			data.orientation,
			true,
		);
	});

const ReadMatchDeckCardSchema = z.object({ itemId: z.uuid() });

/**
 * Reads one deck card (plan §7): a pure join over captured pairs, dismissed pairs
 * excluded in SQL, presented_at stamped. A not-yet-captured card is materialized
 * on demand and re-read once (R-E, the cold path).
 */
export const readMatchDeckCard = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => ReadMatchDeckCardSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewItemRead> => {
		return resolveDeckCard(context.session.accountId, data.itemId);
	});

const SubmitMatchDeckActionSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("add-suggestion"),
		itemId: z.uuid(),
		suggestionId: z.uuid(),
	}),
	z.object({
		type: z.literal("dismiss-suggestion"),
		itemId: z.uuid(),
		suggestionId: z.uuid(),
	}),
	z.object({ type: z.literal("finish-card"), itemId: z.uuid() }),
	z.object({ type: z.literal("dismiss-card"), itemId: z.uuid() }),
]);

/**
 * One deck-aware command boundary (plan §9, R-A). Dispatches to the EXISTING
 * atomic domain wrappers — which already do the decision + deck side effects
 * (revision bump, resume_position advance, capture_ahead job) in one txn and keep
 * RETURNS TEXT — then reads the fresh view. The raw TEXT action status is surfaced
 * (never collapsed to a bool); the view reflects the promoted next card.
 *
 * Orientation is derived from the owned item so the two suggestion actions route
 * suggestionId to the correct column (song subject → playlist suggestion column,
 * and vice versa), mirroring addSongToPlaylistFromQueueItem.
 */
export const submitMatchDeckAction = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => SubmitMatchDeckActionSchema.parse(data))
	.handler(async ({ data, context }): Promise<SubmitMatchDeckActionResult> => {
		const accountId = context.session.accountId;
		const action = data;

		const item = await loadOwnedItem(accountId, action.itemId);
		if (!item) {
			// Stale client / foreign item — no orientation to rebuild a view against.
			throw new Error("This review item could not be found.");
		}
		const orientation = item.subject.orientation;
		const isSong = orientation === "song";

		let actionStatus: string;
		switch (action.type) {
			case "add-suggestion": {
				const result = await addQueueItemDecisionAtomically(
					action.itemId,
					accountId,
					isSong ? null : action.suggestionId,
					isSong ? action.suggestionId : null,
				);
				if (Result.isError(result)) {
					reportDeckError(result.error, "submit_match_deck_action", accountId, {
						orientation,
						type: action.type,
					});
					throw new Error("Could not add this suggestion. Please try again.", {
						cause: result.error,
					});
				}
				actionStatus = result.value;
				break;
			}
			case "dismiss-suggestion": {
				const result = await dismissQueueItemSuggestionAtomically(
					action.itemId,
					accountId,
					isSong ? null : action.suggestionId,
					isSong ? action.suggestionId : null,
				);
				if (Result.isError(result)) {
					reportDeckError(result.error, "submit_match_deck_action", accountId, {
						orientation,
						type: action.type,
					});
					throw new Error(
						"Could not dismiss this suggestion. Please try again.",
						{ cause: result.error },
					);
				}
				actionStatus = result.value;
				break;
			}
			case "finish-card": {
				const result = await finishQueueItemAtomically(
					action.itemId,
					accountId,
				);
				if (Result.isError(result)) {
					reportDeckError(result.error, "submit_match_deck_action", accountId, {
						orientation,
						type: action.type,
					});
					throw new Error("Could not finish this card. Please try again.", {
						cause: result.error,
					});
				}
				actionStatus = result.value;
				break;
			}
			case "dismiss-card": {
				const result = await dismissQueueItemAtomically(
					action.itemId,
					accountId,
				);
				if (Result.isError(result)) {
					reportDeckError(result.error, "submit_match_deck_action", accountId, {
						orientation,
						type: action.type,
					});
					throw new Error("Could not dismiss this card. Please try again.", {
						cause: result.error,
					});
				}
				actionStatus = result.value;
				break;
			}
		}

		// Read-after-write: the action already advanced the deck in-txn, so the
		// fresh view reflects the promoted next card / caught-up state. skipHashComputation
		// (M10): this can only land on branch 1 (active session) in practice, which
		// never reads the hash — probe with a null hash first and skip the two-round-trip
		// hash computation whenever that's confirmed.
		const view = await resolveMatchDeckView(accountId, orientation, false, {
			skipHashComputation: true,
		});

		// One event per deck action carrying the deck revision (from the fresh
		// view) and the action type/status. Best-effort — never blocks the action.
		captureProductEventBestEffort({
			distinctId: accountId,
			accountId,
			event: "match_deck_action",
			operation: "capture_match_deck_action",
			properties: {
				orientation,
				action_type: action.type,
				action_status: actionStatus,
				revision: "revision" in view ? view.revision : null,
			},
		});

		return { actionStatus, view };
	});
