import {
	type QueryClient,
	useInfiniteQuery,
	useMutation,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
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

	const dismissMutation = useMutation(
		dismissSuggestionMutation(queryClient, itemId),
	);

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

	const dismissSuggestion = useCallback(
		async (suggestionId: string) => {
			try {
				const result = await dismissMutation.mutateAsync(suggestionId);
				return result.success;
			} catch {
				// dismissSuggestionMutation's onError already rolled back the caches
				// and reported the failure — the caller only needs the boolean.
				return false;
			}
		},
		[dismissMutation.mutateAsync],
	);

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
	};
}
