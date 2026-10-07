/**
 * Server fns for the Match deck read model (plan §4/§7/§8/§9). The contract
 * lives in match-review-queue/deck-view.ts and the reads in deck-entry.ts; this
 * file adds auth, input validation, the Result→throw boundary and product events.
 *   - startOrResumeMatchDeck — one bounded /match-entry call (plan §8).
 *   - readMatchDeckCard — one card, materialized on demand when the worker
 *     hasn't captured it yet (R-E).
 *   - submitMatchDeckAction — dispatch to the existing atomic domain wrappers
 *     (they already do the deck side effects in-txn and keep RETURNS TEXT), then
 *     read the fresh view (R-A: read-after-write, no return-type migration).
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import {
	type DeckEntryError,
	type ResolvedMatchDeck,
	resolveDeckCard,
	resolveMatchDeck,
} from "@/lib/domains/taste/match-review-queue/deck-entry";
import type {
	MatchDeckAction,
	MatchReviewItemRead,
	StartOrResumeMatchDeckResult,
	SubmitMatchDeckActionResult,
} from "@/lib/domains/taste/match-review-queue/deck-view";
import {
	addQueueItemDecisionAtomically,
	dismissQueueItemAtomically,
	dismissQueueItemSuggestionAtomically,
	finishQueueItemAtomically,
	getOwnedQueueItem,
} from "@/lib/domains/taste/match-review-queue/queries";
import {
	type MatchOrientation,
	MatchOrientationSchema,
} from "@/lib/domains/taste/match-review-queue/types";
import { captureProductEventBestEffort } from "@/lib/observability/capture-product-event";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import type { DbError } from "@/lib/shared/errors/database";

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

const PREPARE_FAILED = "Could not prepare your match deck. Please try again.";
const LOAD_FAILED = "Could not load your match deck. Please try again.";

const DECK_ENTRY_FAILURES: Record<
	DeckEntryError["step"],
	{ operation: string; message: string }
> = {
	visibility_hash: {
		operation: "resolve_match_deck_view",
		message: PREPARE_FAILED,
	},
	start_or_resume: {
		operation: "resolve_match_deck_view",
		message: LOAD_FAILED,
	},
	latest_snapshot: {
		operation: "resolve_match_deck_view",
		message: LOAD_FAILED,
	},
	miss_build: {
		operation: "resolve_match_deck_view_miss",
		message: PREPARE_FAILED,
	},
};

function throwDeckEntryError(
	error: DeckEntryError,
	accountId: string,
	orientation: MatchOrientation,
): never {
	const { operation, message } = DECK_ENTRY_FAILURES[error.step];
	reportDeckError(error.cause, operation, accountId, { orientation });
	throw new Error(message, { cause: error.cause });
}

/**
 * Deck entry hit / miss events. A hit resolved to a live view, either directly
 * active or via the miss-path promotion — `source` lets the hit-rate dashboard
 * separate warm hits from self-heals. A miss `reason` separates "no snapshot
 * published yet" (genuinely nothing to show) from "built but still
 * empty/racing" (self-heals on the next entry). Best-effort.
 */
function captureDeckEntry(
	accountId: string,
	orientation: MatchOrientation,
	resolved: ResolvedMatchDeck,
): void {
	switch (resolved.entry) {
		case "active":
		case "promoted":
			captureProductEventBestEffort({
				distinctId: accountId,
				accountId,
				event: "match_deck_hit",
				operation: "capture_match_deck_hit",
				properties: {
					orientation,
					source: resolved.entry,
					revision: resolved.view.revision,
					remaining: resolved.view.progress.remaining,
				},
			});
			return;
		case "no_snapshot":
		case "promotion_incomplete":
			captureProductEventBestEffort({
				distinctId: accountId,
				accountId,
				event: "match_deck_miss_reason",
				operation: "capture_match_deck_miss_reason",
				properties: { orientation, reason: resolved.entry },
			});
			return;
	}
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
		const accountId = context.session.accountId;
		const result = await resolveMatchDeck(accountId, data.orientation, "entry");
		if (Result.isError(result)) {
			throwDeckEntryError(result.error, accountId, data.orientation);
		}
		captureDeckEntry(accountId, data.orientation, result.value);
		return result.value.view;
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
		const accountId = context.session.accountId;
		const read = await resolveDeckCard(accountId, data.itemId);
		if (read.materialized) {
			// The on-demand materialize fired (the swiper outran capture-ahead).
			// `recovered` separates a self-heal from a still-cold read. Best-effort.
			captureProductEventBestEffort({
				distinctId: accountId,
				accountId,
				event: "match_deck_materialize_on_read",
				operation: "capture_match_deck_materialize_on_read",
				properties: {
					item_id: data.itemId,
					recovered: read.materialized.recovered,
					orientation: read.materialized.orientation,
				},
			});
		}
		return read.card;
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

const DECK_ACTION_FAILURES: Record<MatchDeckAction["type"], string> = {
	"add-suggestion": "Could not add this suggestion. Please try again.",
	"dismiss-suggestion": "Could not dismiss this suggestion. Please try again.",
	"finish-card": "Could not finish this card. Please try again.",
	"dismiss-card": "Could not dismiss this card. Please try again.",
};

/**
 * Routes the suggestion id to the orientation-correct column (song subject →
 * playlist suggestion column, and vice versa), mirroring
 * addSongToPlaylistFromQueueItem.
 */
function dispatchDeckAction(
	action: MatchDeckAction,
	accountId: string,
	orientation: MatchOrientation,
): Promise<Result<string, DbError>> {
	const isSong = orientation === "song";
	switch (action.type) {
		case "add-suggestion":
			return addQueueItemDecisionAtomically(
				action.itemId,
				accountId,
				isSong ? null : action.suggestionId,
				isSong ? action.suggestionId : null,
			);
		case "dismiss-suggestion":
			return dismissQueueItemSuggestionAtomically(
				action.itemId,
				accountId,
				isSong ? null : action.suggestionId,
				isSong ? action.suggestionId : null,
			);
		case "finish-card":
			return finishQueueItemAtomically(action.itemId, accountId);
		case "dismiss-card":
			return dismissQueueItemAtomically(action.itemId, accountId);
	}
}

/**
 * One deck-aware command boundary (plan §9, R-A). Dispatches to the EXISTING
 * atomic domain wrappers — which already do the decision + deck side effects
 * (revision bump, resume_position advance, capture_ahead job) in one txn and keep
 * RETURNS TEXT — then reads the fresh view. The raw TEXT action status is surfaced
 * (never collapsed to a bool); the view reflects the promoted next card.
 *
 * Orientation is derived from the owned item so the two suggestion actions can
 * route suggestionId to the correct column.
 */
export const submitMatchDeckAction = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => SubmitMatchDeckActionSchema.parse(data))
	.handler(async ({ data, context }): Promise<SubmitMatchDeckActionResult> => {
		const accountId = context.session.accountId;
		const action = data;

		const itemResult = await getOwnedQueueItem(accountId, action.itemId);
		if (Result.isError(itemResult)) {
			reportDeckError(
				itemResult.error,
				"submit_match_deck_action_load_item",
				accountId,
				{ itemId: action.itemId },
			);
			throw new Error("Could not process your action. Please try again.", {
				cause: itemResult.error,
			});
		}
		const item = itemResult.value;
		if (!item) {
			// Stale client / foreign item — no orientation to rebuild a view against.
			throw new Error("This review item could not be found.");
		}
		const orientation = item.subject.orientation;

		const dispatched = await dispatchDeckAction(action, accountId, orientation);
		if (Result.isError(dispatched)) {
			reportDeckError(dispatched.error, "submit_match_deck_action", accountId, {
				orientation,
				type: action.type,
			});
			throw new Error(DECK_ACTION_FAILURES[action.type], {
				cause: dispatched.error,
			});
		}
		const actionStatus = dispatched.value;

		// Read-after-write: the action already advanced the deck in-txn, so the
		// fresh view reflects the promoted next card / caught-up state. Not an
		// entry, so it emits no hit/miss event.
		const resolved = await resolveMatchDeck(
			accountId,
			orientation,
			"after_action",
		);
		if (Result.isError(resolved)) {
			throwDeckEntryError(resolved.error, accountId, orientation);
		}
		const view = resolved.value.view;

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
