import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import type { MatchingSongSuggestion } from "@/lib/domains/taste/match-review-queue/deck-view";
import type {
	QueueItemSongSuggestionCursor,
	QueueItemSongSuggestionRow,
} from "@/lib/domains/taste/match-review-queue/queries";
import {
	getOwnedQueueItem,
	readQueueItemSongSuggestions,
} from "@/lib/domains/taste/match-review-queue/queries";
import { deriveSuggestionNextCursor } from "@/lib/domains/taste/match-review-queue/suggestion-cursor";
import {
	type MatchOrientation,
	MatchOrientationSchema,
} from "@/lib/domains/taste/match-review-queue/types";
import { captureServerError } from "@/lib/observability/capture-server-error";

/**
 * The errors thrown out of the queue boundary below intentionally hide DB
 * internals from the client — but until now they hid them from us too: the
 * typed error was dropped, so a failed `/match` reached Sentry only as the
 * generic client-side message, with no code or cause. Capture the error (tag +
 * underlying PostgREST/PG code) before translating it, so the next failure is
 * diagnosable server-side instead of requiring a manual repro.
 */
function reportQueueError(
	error: unknown,
	operation: string,
	context: { accountId: string; orientation: MatchOrientation },
): void {
	captureServerError(error, {
		area: "match_review_queue",
		operation,
		accountId: context.accountId,
		extra: { orientation: context.orientation },
	});
}

import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import {
	resolveMatchReviewSummary,
	resolvePreferredMatchReviewSummary,
	type ServerMatchReviewSummaryResult,
} from "./match-review-summary.server";

const NoInputSchema = z.undefined();

/** Tail page size for listMatchReviewItemSuggestions (P3). Larger than the first
 * page since it loads in the background/on scroll rather than blocking paint. */
const PLAYLIST_CARD_TAIL_PAGE_SIZE = 24;

/**
 * Maps one read-model row to the client-facing MatchingSongSuggestion shape.
 * Shared by the deck card's first page and listMatchReviewItemSuggestions' tail
 * pages so the two can't drift.
 */
function mapSuggestionRow(
	row: QueueItemSongSuggestionRow,
): MatchingSongSuggestion {
	return {
		song: {
			id: row.songId,
			spotifyId: row.spotifyId,
			name: row.name,
			artist: row.artists[0] ?? "Unknown Artist",
			album: row.albumName,
			albumArtUrl: row.imageUrl,
			genres: row.genres,
			// Audio features and analysis are not surfaced in the playlist-mode
			// card render; fetching them would add two joins with no UI benefit.
			audioFeatures: null,
			analysis: null,
		},
		// fitScore = strictnessScore from the captured pair — never reranker/ordering (A5, E7).
		fitScore: row.fitScore,
	};
}

/** Cursor alias for the client — mirrors the domain layer's keyset cursor shape. */
export type MatchReviewItemSuggestionCursor = QueueItemSongSuggestionCursor;

export interface ListMatchReviewItemSuggestionsPage {
	suggestions: MatchingSongSuggestion[];
	nextCursor: MatchReviewItemSuggestionCursor | null;
}

const ListMatchReviewItemSuggestionsSchema = z.object({
	itemId: z.uuid(),
	cursor: z
		.object({
			fitScore: z.number(),
			modelRank: z.number(),
			songId: z.uuid(),
		})
		.nullable(),
});

/**
 * Tail page for a playlist card's suggestion list (P3, first-page-fast): pages
 * in the rows the deck card's first page didn't include in the first
 * PLAYLIST_CARD_FIRST_PAGE_SIZE-row response. Shares readQueueItemSongSuggestions
 * and mapSuggestionRow with the first-page path so first page and tail pages
 * can never render suggestions differently.
 *
 * Ownership-verified but deliberately quiet on a genuine miss: a foreign/missing
 * item or a song-orientation item (this path is playlist-mode only) both degrade
 * to an empty page rather than leaking ownership/orientation details to the
 * caller.
 *
 * A DB error on either read — the ownership check OR the suggestion rows — is
 * thrown (not returned as an empty page) so the client's infinite query enters
 * its `error` state. Treating a real read failure as "no more pages" would
 * silently truncate a >8-row card's tail forever, which is why an ownership
 * read error is thrown rather than treated as a miss.
 */
export const listMatchReviewItemSuggestions = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => ListMatchReviewItemSuggestionsSchema.parse(data))
	.handler(
		async ({ data, context }): Promise<ListMatchReviewItemSuggestionsPage> => {
			const { session } = context;
			const { itemId, cursor } = data;

			const itemResult = await getOwnedQueueItem(session.accountId, itemId);
			// A failed ownership read must NOT collapse to "no more pages": that
			// would silently truncate a >8-row card's tail forever (the same reason
			// the suggestion-rows error below is thrown, not swallowed). Orientation
			// lives on the row that failed to load, so the capture carries the item
			// id instead.
			if (Result.isError(itemResult)) {
				captureServerError(itemResult.error, {
					area: "match_review_queue",
					operation: "list_match_review_item_suggestions",
					accountId: session.accountId,
					extra: { itemId },
				});
				throw new Error("Couldn't load more suggestions. Please try again.", {
					cause: itemResult.error,
				});
			}
			const item = itemResult.value;
			if (!item || item.subject.orientation !== "playlist") {
				return { suggestions: [], nextCursor: null };
			}

			const rowsResult = await readQueueItemSongSuggestions(
				itemId,
				session.accountId,
				{ limit: PLAYLIST_CARD_TAIL_PAGE_SIZE, after: cursor ?? undefined },
			);

			if (Result.isError(rowsResult)) {
				reportQueueError(
					rowsResult.error,
					"list_match_review_item_suggestions",
					{ accountId: session.accountId, orientation: "playlist" },
				);
				throw new Error("Couldn't load more suggestions. Please try again.");
			}

			const rows = rowsResult.value;
			// A full page can still be the last one — the next call simply comes back
			// empty; that final empty fetch is standard for a cursor-paged infinite
			// query, so a full tail page alone is the nextCursor signal (total omitted).
			const nextCursor = deriveSuggestionNextCursor(
				rows,
				PLAYLIST_CARD_TAIL_PAGE_SIZE,
			);

			return {
				suggestions: rows.map(mapSuggestionRow),
				nextCursor,
			};
		},
	);

// ============================================================================
// Queue summary (Phase 7 — dashboard CTA, sidebar badge, empty-state)
// ============================================================================

const GetMatchReviewSummarySchema = z.object({
	orientation: MatchOrientationSchema,
});

/**
 * Returns the queue-aware match review summary.
 * Backs the sidebar badge and is available for targeted refetch.
 * Dashboard calls resolveMatchReviewSummary directly (no extra HTTP round-trip).
 */
export const getMatchReviewSummary = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetMatchReviewSummarySchema.parse(data))
	.handler(
		async ({ data, context }): Promise<ServerMatchReviewSummaryResult> => {
			return resolveMatchReviewSummary(
				context.session.accountId,
				data.orientation,
			);
		},
	);

/**
 * Server function version of resolvePreferredMatchReviewSummary.
 * Backs preferredSummary query key — invalidated after a preference update.
 */
export const getPreferredMatchReviewSummary = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<ServerMatchReviewSummaryResult> => {
		return resolvePreferredMatchReviewSummary(context.session.accountId);
	});
