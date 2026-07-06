import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import {
	readMatchDeckCard,
	startOrResumeMatchDeck,
} from "@/lib/server/match-deck.functions";
import {
	listMatchReviewItemSuggestions,
	type MatchReviewItemSuggestionCursor,
} from "@/lib/server/match-review-queue.functions";

/**
 * Query keys for the Phase 3 deck read model. Separate from matchReviewKeys so
 * the deck query family can run alongside the legacy families through the
 * cutover (the route swap is Phase 4). Deck state is one source of truth per
 * (account, orientation); per-card reads and tail suggestions hang off itemId.
 */
export const matchDeckKeys = {
	all: ["match-deck"] as const,
	// Prefix for all deck (start/resume) keys — broad invalidation on snapshot
	// refresh or a strictness/filter change that affects every orientation.
	deckRoot: ["match-deck", "deck"] as const,
	deck: (accountId: string, orientation: MatchOrientation) =>
		["match-deck", "deck", accountId, orientation] as const,
	card: (itemId: string) => ["match-deck", "card", itemId] as const,
};

/**
 * The single deck query the route renders from (plan §8/§10): one bounded
 * start/resume call returning the exact MatchDeckView (or the building state).
 * 60s staleTime mirrors matchReviewQueryOptions — short enough that a
 * snapshot-refresh invalidation refetches promptly, long enough that rapid card
 * navigation doesn't hammer the server.
 */
export function matchDeckQueryOptions(
	accountId: string,
	orientation: MatchOrientation,
) {
	return queryOptions({
		queryKey: matchDeckKeys.deck(accountId, orientation),
		queryFn: () => startOrResumeMatchDeck({ data: { orientation } }),
		staleTime: 60_000,
	});
}

/**
 * Per-card read for cards the deck view didn't bake in (plan §10 point 3): a pure
 * read over captured pairs, with the on-demand materialize fallback inside the
 * server fn. High staleTime matches presentMatchReviewItemQueryOptions — a card
 * read is keyed off an immutable captured suggestion order, so no refetch is
 * needed within one review visit.
 */
export function readMatchDeckCardQueryOptions(itemId: string) {
	return queryOptions({
		queryKey: [...matchDeckKeys.card(itemId), "read"] as const,
		queryFn: () => readMatchDeckCard({ data: { itemId } }),
		staleTime: 30 * 60_000,
	});
}

/**
 * Tail pages for a playlist deck card's suggestion list, keyed under the deck
 * family (plan §7 "tail pages kept, re-keyed under the deck query family"). Reuses
 * the existing listMatchReviewItemSuggestions server fn + cursor — the read RPC is
 * shared, only the cache key differs from the legacy family.
 *
 * `initialCursor` comes from the ready playlist card's `nextCursor` — null both
 * when the first page held the whole (capped) set AND for song-mode cards (whose
 * nextCursor is always null), so `enabled` gates network work in both cases.
 */
export function matchDeckCardSuggestionsInfiniteQueryOptions(
	itemId: string,
	initialCursor: MatchReviewItemSuggestionCursor | null,
) {
	return infiniteQueryOptions({
		queryKey: [...matchDeckKeys.card(itemId), "suggestions"] as const,
		queryFn: ({ pageParam }) =>
			listMatchReviewItemSuggestions({ data: { itemId, cursor: pageParam } }),
		initialPageParam: initialCursor,
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		enabled: initialCursor !== null,
		staleTime: 30 * 60_000,
	});
}
