/**
 * Single deck card reads (plan §7): a pure read with the on-demand materialize
 * fallback (R-E) for a card the worker hasn't captured ahead yet. Every failure
 * degrades to the retryable card rather than an error.
 */

import { Result } from "better-result";
import { captureAheadForSession } from "./card-materializer";
import { SONG_CARD_SUGGESTION_CAP } from "./card-suggestion-caps";
import { callReadMatchDeckCard } from "./deck-read-queries";
import {
	captureUnexpectedCardShape,
	type MatchReviewItemRead,
	mapReadDeckCardToItemRead,
	reportDeckError,
} from "./deck-view";
import { getOwnedQueueItem } from "./queries";
import type { MatchOrientation } from "./types";

/** A card read; `materialization` records the cold path (R-E) when it ran. */
export interface DeckCardRead {
	card: MatchReviewItemRead;
	materialization: {
		recovered: boolean;
		orientation: MatchOrientation | null;
	} | null;
}

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
	const itemResult = await getOwnedQueueItem(accountId, itemId);
	if (Result.isError(itemResult)) {
		reportDeckError(
			itemResult.error,
			"read_match_deck_card_load_item",
			accountId,
			{ itemId },
		);
		return null;
	}
	const item = itemResult.value;
	if (!item) return null;
	const orientation = item.subject.orientation;

	const captureResult = await captureAheadForSession({
		accountId,
		sessionId: item.sessionId,
		orientation,
		fromPosition: item.position,
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

/**
 * Reads one deck card (plan §7) by item id. A card the worker hasn't captured
 * yet is materialized on demand and re-read once (R-E); every failure degrades
 * to the retryable card rather than an error.
 */
export async function resolveDeckCard(
	accountId: string,
	itemId: string,
): Promise<DeckCardRead> {
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
			card: {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			},
			materialization: null,
		};
	}

	const first = firstResult.value;
	captureUnexpectedCardShape(accountId, itemId, first);
	if (first.status !== "not_captured") {
		// Orientation only feeds the no_visible_suggestions copy, and that payload
		// doesn't carry it — null → orientation-neutral copy (never a mislabel).
		return {
			card: mapReadDeckCardToItemRead(first, itemId, window, null),
			materialization: null,
		};
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

	return {
		card: coldResult,
		materialization: {
			recovered,
			orientation: materialized?.orientation ?? null,
		},
	};
}
