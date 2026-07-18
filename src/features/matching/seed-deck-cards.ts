/**
 * Seeds baked deck cards into the card-read cache. Shared between the /match
 * loader (RB — seeds the cold-SSR baked current+next cards) and
 * QueueCardContent's applyResolvedView (RF — seeds a whole-card action's
 * promoted cards) so both sites treat a baked `retryable-error` card the same
 * way: auto-retried once through the authoritative card read instead of
 * pinned into the long-lived card cache.
 */

import type { QueryClient } from "@tanstack/react-query";
import { readMatchDeckCardQueryOptions } from "@/features/matching/deck-queries";
import type { MatchDeckCard } from "@/lib/server/match-deck.functions";

export async function seedBakedDeckCardReads(
	queryClient: Pick<QueryClient, "setQueryData" | "prefetchQuery">,
	cards: Array<MatchDeckCard | null>,
): Promise<void> {
	const retries: Promise<unknown>[] = [];

	for (const card of cards) {
		if (!card) continue;
		if (card.presentation.status === "retryable-error") {
			// Auto-retry once through the authoritative card read instead of
			// pinning a transient baked error into the 30-minute card cache.
			retries.push(
				queryClient.prefetchQuery(readMatchDeckCardQueryOptions(card.itemId)),
			);
			continue;
		}
		queryClient.setQueryData(
			readMatchDeckCardQueryOptions(card.itemId).queryKey,
			card.presentation,
		);
	}

	await Promise.all(retries);
}
