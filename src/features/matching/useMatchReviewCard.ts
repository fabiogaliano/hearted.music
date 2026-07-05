import {
	type QueryClient,
	useInfiniteQuery,
	useMutation,
} from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import type {
	MatchReviewItemRead,
	MatchReviewItemSuggestionCursor,
} from "@/lib/server/match-review-queue.functions";
import type { MatchingSongSuggestion } from "@/lib/server/matching.functions";
import { dismissSuggestionMutation } from "./mutations";
import { matchReviewItemSuggestionsInfiniteQueryOptions } from "./queries";
import type { MatchingReviewItem, MatchingSuggestion } from "./types";

export interface UseMatchReviewCardParams {
	itemId: string;
	itemData: MatchReviewItemRead;
	queryClient: QueryClient;
}

export interface UseMatchReviewCardResult {
	currentReviewItem: MatchingReviewItem | null;
	currentSuggestions: MatchingSuggestion[];
	/** Playlist-mode only (capped, post-dismissal total); undefined in song mode. */
	suggestionTotal: number | undefined;
	/** True while a tail page may still exist — see the derivation note below. */
	hasMoreSuggestions: boolean;
	isLoadingMoreSuggestions: boolean;
	loadMoreSuggestions: () => void;
	loadMoreError: Error | null;
	retryLoadMore: () => void;
	/** Resolves true on a confirmed dismiss, false on rejection/failure (already rolled back). */
	dismissSuggestion: (suggestionId: string) => Promise<boolean>;
	/** Awaits any in-flight dismiss chain for this card so whole-card actions don't race. */
	waitForPendingDismisses: () => Promise<void>;
}

/**
 * First tracer-bullet slice of the larger useMatchReviewSession extraction
 * (Deepening #2): owns tail paging, merged suggestions, and the
 * suggestion-dismiss mutation for one review card, so match.tsx's
 * QueueCardContent stays responsible only for navigation/session concerns.
 *
 * `itemData` is the already-fetched present() read (the route's
 * useSuspenseQuery) — this hook does not fetch it, only derives from it and
 * layers the tail query + mutation on top.
 */
export function useMatchReviewCard({
	itemId,
	itemData,
	queryClient,
}: UseMatchReviewCardParams): UseMatchReviewCardResult {
	// null for song mode (no nextCursor field at all) and for a playlist card
	// whose first page was the whole (capped) suggestion set — both cases must
	// leave the tail query disabled, which is why `enabled` derives from this
	// value rather than from mode alone.
	const initialCursor: MatchReviewItemSuggestionCursor | null =
		itemData.status === "ready" && itemData.mode === "playlist"
			? itemData.nextCursor
			: null;

	const tailQuery = useInfiniteQuery(
		matchReviewItemSuggestionsInfiniteQueryOptions(itemId, initialCursor),
	);

	const dismissMutation = useMutation(dismissSuggestionMutation(queryClient));

	// Cheap union-to-union mapping — not memoized, matching the previous
	// inline version's cost profile (route.tsx's now-removed IIFE).
	const currentReviewItem: MatchingReviewItem | null = (() => {
		if (itemData.status !== "ready") return null;
		if (itemData.mode === "song") {
			return {
				mode: "song" as const,
				song: {
					id: itemData.reviewItem.id,
					spotifyId: itemData.reviewItem.spotifyId,
					name: itemData.reviewItem.name,
					artist: itemData.reviewItem.artist,
					album: itemData.reviewItem.album ?? null,
					albumArtUrl: itemData.reviewItem.albumArtUrl,
					genres: itemData.reviewItem.genres,
					audioFeatures: itemData.reviewItem.audioFeatures ?? null,
					analysis: itemData.reviewItem.analysis ?? null,
				},
			};
		}
		return {
			mode: "playlist" as const,
			playlist: {
				id: itemData.reviewItem.id,
				spotifyId: itemData.reviewItem.spotifyId,
				name: itemData.reviewItem.name,
				description: itemData.reviewItem.description,
				imageUrl: itemData.reviewItem.imageUrl,
				trackCount: itemData.reviewItem.trackCount,
			},
		};
	})();

	const currentSuggestions = useMemo((): MatchingSuggestion[] => {
		if (itemData.status !== "ready") return [];

		if (itemData.mode === "song") {
			return itemData.suggestions.map((m) => ({
				mode: "song" as const,
				playlist: {
					id: m.playlist.id,
					spotifyId: m.playlist.spotifyId,
					name: m.playlist.name,
					reason: m.playlist.description ?? "",
					matchScore: m.score,
					imageUrl: m.playlist.imageUrl,
					songCount: m.playlist.trackCount,
				},
			}));
		}

		// Playlist mode: merge the present-card first page with loaded tail
		// pages, deduped by song id. Dedup guards a present-query refetch whose
		// fresh first page can overlap with already-loaded (now stale) tail
		// pages — first occurrence wins, so the fresher first-page row is kept.
		const tailSuggestions =
			tailQuery.data?.pages.flatMap((page) => page.suggestions) ?? [];
		const seenSongIds = new Set<string>();
		const mergedSuggestions: MatchingSongSuggestion[] = [];
		for (const suggestion of [...itemData.suggestions, ...tailSuggestions]) {
			if (seenSongIds.has(suggestion.song.id)) continue;
			seenSongIds.add(suggestion.song.id);
			mergedSuggestions.push(suggestion);
		}

		return mergedSuggestions.map((s) => ({
			mode: "playlist" as const,
			song: {
				id: s.song.id,
				spotifyId: s.song.spotifyId,
				name: s.song.name,
				artist: s.song.artist,
				album: s.song.album ?? null,
				albumArtUrl: s.song.albumArtUrl,
				genres: s.song.genres,
				audioFeatures: s.song.audioFeatures ?? null,
				analysis: s.song.analysis ?? null,
			},
			fitScore: s.fitScore,
		}));
	}, [itemData, tailQuery.data]);

	const suggestionTotal =
		itemData.status === "ready" && itemData.mode === "playlist"
			? itemData.suggestionTotal
			: undefined;

	// NOT just tailQuery.hasNextPage: before the auto-fired first tail page
	// resolves, hasNextPage can still read false (no page fetched yet to derive
	// it from), which would flash "no more" between the card mounting and that
	// first fetch settling. `!tailQuery.data` covers exactly that window.
	const hasMoreSuggestions =
		initialCursor !== null && (!tailQuery.data || tailQuery.hasNextPage);

	const loadMoreSuggestions = useCallback(() => {
		// Guards against duplicating the enabled-gated auto first-page fetch —
		// a sentinel that renders before that fetch settles must not double-call.
		if (!tailQuery.hasNextPage || tailQuery.isFetchingNextPage) return;
		void tailQuery.fetchNextPage();
	}, [
		tailQuery.hasNextPage,
		tailQuery.isFetchingNextPage,
		tailQuery.fetchNextPage,
	]);

	const retryLoadMore = useCallback(() => {
		void tailQuery.fetchNextPage();
	}, [tailQuery.fetchNextPage]);

	// Serializes overlapping dismisses within ONE card. The dismiss mutation
	// snapshots that card's present + tail caches in onMutate and restores the
	// snapshot on a failed rollback, so two dismisses of the SAME card must never
	// interleave: if B snapshots after A removed its row but before A fails, A's
	// rollback would resurrect the row B already dismissed. TanStack's mutation
	// `scope` can't prevent this — it serializes only the mutationFn, not onMutate
	// (onMutate runs before the retryer). So we chain each dismiss behind the prior
	// one's FULL settlement here: mutateAsync resolves only after onSuccess/onError
	// (and thus the rollback) have run, so the next dismiss's onMutate always
	// snapshots a settled cache.
	//
	// The chain is keyed by itemId because the mutation's snapshot keys are
	// per-item (see dismissSuggestionMutation): dismisses on different cards touch
	// disjoint caches and can't resurrect each other, so they must NOT serialize.
	// QueueCardContent stays mounted across cards (itemId flows in as a prop, no
	// remount), so a single shared chain would wrongly stall — and drop optimistic
	// feedback for — a new card's dismiss behind a still-pending dismiss on the
	// card the user just left. A Map per itemId also makes re-entry to a card
	// resume its own chain rather than reset it mid-flight.
	const dismissChainsRef = useRef<Map<string, Promise<unknown>>>(new Map());

	const dismissSuggestion = useCallback(
		async (suggestionId: string) => {
			const chains = dismissChainsRef.current;
			const prior = chains.get(itemId) ?? Promise.resolve();
			// itemId is captured in these variables at enqueue time, so a dismiss
			// queued here still targets THIS card even if it settles after the user
			// navigated away (see dismissSuggestionMutation's variables note).
			const run = prior.then(() =>
				dismissMutation.mutateAsync({ itemId, suggestionId }),
			);
			// The chain must survive a rejected dismiss so the next one still runs;
			// swallow here (the boolean the caller needs is derived from `run` below).
			const settled = run.then(
				() => undefined,
				() => undefined,
			);
			chains.set(itemId, settled);
			// Evict the settled chain unless a newer dismiss has already queued behind
			// it, so the Map doesn't retain one resolved-promise entry per card visited
			// across a long review session. A later dismiss on the same card overwrites
			// the entry first, so the identity check leaves any live chain intact.
			// Serialization is unaffected: an evicted entry was fully settled, so the
			// next dismiss's Promise.resolve() fallback is equivalent to what it replaced.
			void settled.then(() => {
				if (chains.get(itemId) === settled) chains.delete(itemId);
			});

			try {
				const result = await run;
				return result.success;
			} catch {
				// dismissSuggestionMutation's onError already rolled back the caches
				// and reported the failure — the caller only needs the boolean.
				return false;
			}
		},
		[dismissMutation.mutateAsync, itemId],
	);

	const waitForPendingDismisses = useCallback(async () => {
		// Drain in a loop, not a single read: a row dismiss enqueued during the
		// await window chains behind the promise we snapshotted and replaces the
		// map entry, so awaiting only the snapshot would return while that newer
		// dismiss is still mid-onMutate. Re-read after each await; stop once the
		// entry is unchanged (nothing queued) or gone (evicted after settling).
		let chain = dismissChainsRef.current.get(itemId);
		while (chain) {
			await chain;
			const next = dismissChainsRef.current.get(itemId);
			if (next === chain) break;
			chain = next;
		}
	}, [itemId]);

	return {
		currentReviewItem,
		currentSuggestions,
		suggestionTotal,
		hasMoreSuggestions,
		isLoadingMoreSuggestions: tailQuery.isFetchingNextPage,
		loadMoreSuggestions,
		loadMoreError: tailQuery.error,
		retryLoadMore,
		dismissSuggestion,
		waitForPendingDismisses,
	};
}
