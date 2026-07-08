/**
 * The single keyset-cursor derivation for a card's suggestion list, shared by the
 * deck-card mapper's first page and the tail-page endpoint
 * (listMatchReviewItemSuggestions). Previously this ternary was copy-pasted and
 * drifted; one pure helper removes the drift.
 *
 * Rule: a next cursor exists only when the page came back FULL (`rows.length ===
 * pageSize`) — a short page is always the last one. First-page callers also pass
 * the post-dismissal `total` so a page that already holds the whole (capped) set
 * reports no tail; the tail caller omits `total` (a full tail page always earns a
 * cursor, and the final over-fetch simply returns empty).
 */

import type { QueueItemSongSuggestionCursor } from "./queries";

/** The sort-key fields the cursor is built from — the RPC's total order. */
type SuggestionCursorRow = {
	fitScore: number;
	modelRank: number;
	songId: string;
};

export function deriveSuggestionNextCursor(
	rows: readonly SuggestionCursorRow[],
	pageSize: number,
	total?: number,
): QueueItemSongSuggestionCursor | null {
	const last = rows.at(-1);
	if (!last || rows.length !== pageSize) return null;
	if (total !== undefined && rows.length >= total) return null;
	return {
		fitScore: last.fitScore,
		modelRank: last.modelRank,
		songId: last.songId,
	};
}
