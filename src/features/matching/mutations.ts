import {
	type InfiniteData,
	mutationOptions,
	type QueryClient,
} from "@tanstack/react-query";
import { captureRouteError } from "@/lib/observability/sentry";
import {
	type DismissSuggestionResult,
	dismissMatchReviewItemSuggestion,
	type ListMatchReviewItemSuggestionsPage,
	type MatchReviewItemRead,
	type MatchReviewItemSuggestionCursor,
} from "@/lib/server/match-review-queue.functions";
import { matchReviewKeys, presentMatchReviewItemQueryOptions } from "./queries";

type TailPagesData = InfiniteData<
	ListMatchReviewItemSuggestionsPage,
	MatchReviewItemSuggestionCursor | null
>;

/**
 * Removes a dismissed suggestion from the present-card cache. Handles both
 * arms: song mode filters by playlist id (suggestionId is a playlist there),
 * playlist mode filters by song id and decrements suggestionTotal (floored at
 * 0 — the capped total can't go negative even if two dismisses race).
 *
 * Pure so it is unit-testable as input -> output without a live QueryClient.
 */
export function patchPresentCacheOnSuggestionDismiss(
	item: MatchReviewItemRead | undefined,
	suggestionId: string,
): MatchReviewItemRead | undefined {
	if (!item || item.status !== "ready") return item;

	if (item.mode === "song") {
		return {
			...item,
			suggestions: item.suggestions.filter(
				(s) => s.playlist.id !== suggestionId,
			),
		};
	}

	return {
		...item,
		suggestions: item.suggestions.filter((s) => s.song.id !== suggestionId),
		suggestionTotal: Math.max(0, item.suggestionTotal - 1),
	};
}

/**
 * Removes a dismissed suggestion from every loaded tail page. Playlist mode
 * only — song mode never populates this cache (its infinite query stays
 * disabled, see matchReviewItemSuggestionsInfiniteQueryOptions), so `data` is
 * undefined there and this is a no-op.
 */
export function patchTailCacheOnSuggestionDismiss(
	data: TailPagesData | undefined,
	suggestionId: string,
): TailPagesData | undefined {
	if (!data) return data;
	return {
		...data,
		pages: data.pages.map((page) => ({
			...page,
			suggestions: page.suggestions.filter((s) => s.song.id !== suggestionId),
		})),
	};
}

interface DismissSuggestionMutationContext {
	previousPresent: MatchReviewItemRead | undefined;
	previousTail: TailPagesData | undefined;
}

/**
 * First `mutationOptions` adoption in the repo (Patterns #2): per-suggestion
 * row dismiss inside a playlist/song card. Paged caches (the tail infinite
 * query) need principled dismiss surgery on top of the present-card cache, so
 * the optimistic update + rollback logic is centralized here rather than
 * inlined at the call site (previously match.tsx).
 *
 * Rollback happens on two distinct paths:
 * - `onSuccess` with `result.success === false` — the server function returns
 *   a rejection shape rather than throwing, so `onError` alone would miss it
 *   and leave a suggestion optimistically removed that the server never
 *   actually dismissed.
 * - `onError` — thrown/network failures.
 */
export function dismissSuggestionMutation(
	queryClient: QueryClient,
	itemId: string,
) {
	const presentKey = presentMatchReviewItemQueryOptions(itemId).queryKey;
	const tailKey = [...matchReviewKeys.item(itemId), "suggestions"] as const;

	const rollback = (context: DismissSuggestionMutationContext | undefined) => {
		if (!context) return;
		queryClient.setQueryData(presentKey, context.previousPresent);
		queryClient.setQueryData(tailKey, context.previousTail);
	};

	return mutationOptions<
		DismissSuggestionResult,
		Error,
		string,
		DismissSuggestionMutationContext
	>({
		mutationFn: (suggestionId) =>
			dismissMatchReviewItemSuggestion({ data: { itemId, suggestionId } }),

		onMutate: async (suggestionId) => {
			await Promise.all([
				queryClient.cancelQueries({ queryKey: presentKey }),
				queryClient.cancelQueries({ queryKey: tailKey }),
			]);

			const previousPresent =
				queryClient.getQueryData<MatchReviewItemRead>(presentKey);
			const previousTail = queryClient.getQueryData<TailPagesData>(tailKey);

			queryClient.setQueryData<MatchReviewItemRead>(presentKey, (current) =>
				patchPresentCacheOnSuggestionDismiss(current, suggestionId),
			);
			queryClient.setQueryData<TailPagesData>(tailKey, (current) =>
				patchTailCacheOnSuggestionDismiss(current, suggestionId),
			);

			return { previousPresent, previousTail };
		},

		onSuccess: (result, _suggestionId, context) => {
			if (!result.success) rollback(context);
		},

		onError: (error, _suggestionId, context) => {
			rollback(context);
			captureRouteError(error, { route: "match-review-suggestion-dismiss" });
		},
	});
}
