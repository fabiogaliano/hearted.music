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

export interface DismissSuggestionVariables {
	itemId: string;
	suggestionId: string;
}

function itemKeys(itemId: string) {
	return {
		presentKey: presentMatchReviewItemQueryOptions(itemId).queryKey,
		tailKey: [...matchReviewKeys.item(itemId), "suggestions"] as const,
	};
}

/**
 * First `mutationOptions` adoption in the repo (Patterns #2): per-suggestion
 * row dismiss inside a playlist/song card. Paged caches (the tail infinite
 * query) need principled dismiss surgery on top of the present-card cache, so
 * the optimistic update + rollback logic is centralized here rather than
 * inlined at the call site (previously match.tsx).
 *
 * `itemId` travels in the mutation *variables* rather than being closed over at
 * construction time. A single MutationObserver is reused across cards (its
 * options are re-set every render as itemId changes), and mutateAsync runs
 * against the observer's CURRENT options — so a dismiss queued on card A that
 * settles after the user navigated to card B would otherwise execute with B's
 * closed-over keys. Deriving keys from the per-call variables makes each
 * execution target the card it was enqueued for, regardless of what is mounted.
 *
 * Rollback happens on two distinct paths:
 * - `onSuccess` with `result.success === false` — the server function returns
 *   a rejection shape rather than throwing, so `onError` alone would miss it
 *   and leave a suggestion optimistically removed that the server never
 *   actually dismissed.
 * - `onError` — thrown/network failures.
 */
export function dismissSuggestionMutation(queryClient: QueryClient) {
	const rollback = (
		itemId: string,
		context: DismissSuggestionMutationContext | undefined,
	) => {
		if (!context) return;
		const { presentKey, tailKey } = itemKeys(itemId);
		queryClient.setQueryData(presentKey, context.previousPresent);
		// Only restore the tail when this mutation actually snapshotted loaded
		// pages. If previousTail was undefined the optimistic tail patch was a
		// no-op, so there is nothing to undo — and writing undefined back here
		// would clobber a first tail page that finished loading during the
		// mutation window, re-stranding the tail (see the onMutate cancel note).
		if (context.previousTail !== undefined) {
			queryClient.setQueryData(tailKey, context.previousTail);
		}
	};

	return mutationOptions<
		DismissSuggestionResult,
		Error,
		DismissSuggestionVariables,
		DismissSuggestionMutationContext
	>({
		// This whole-snapshot rollback is only sound if dismisses for one card never
		// overlap: two concurrent onMutate snapshots plus a failed rollback would
		// resurrect a row a succeeded dismiss removed. That serialization lives in
		// useMatchReviewCard (a per-card promise chain), NOT in a mutation `scope` —
		// scope serializes only the mutationFn, and onMutate runs before it.
		mutationFn: ({ itemId, suggestionId }) =>
			dismissMatchReviewItemSuggestion({ data: { itemId, suggestionId } }),

		onMutate: async ({ itemId, suggestionId }) => {
			const { presentKey, tailKey } = itemKeys(itemId);
			const previousTail = queryClient.getQueryData<TailPagesData>(tailKey);

			// Cancelling an in-flight fetch reverts it. That is fine for the present
			// query and for the tail once it has pages, but cancelling the tail's
			// auto-fired FIRST page (no data yet) reverts it to a data-less,
			// hasNextPage=false state that loadMoreSuggestions refuses to restart —
			// the tail would strand with no way to page in the rest of a >8-row
			// card. When the tail has no data the optimistic patch below is a no-op
			// anyway, so there is nothing to protect by cancelling it.
			await Promise.all([
				queryClient.cancelQueries({ queryKey: presentKey }),
				...(previousTail !== undefined
					? [queryClient.cancelQueries({ queryKey: tailKey })]
					: []),
			]);

			const previousPresent =
				queryClient.getQueryData<MatchReviewItemRead>(presentKey);

			queryClient.setQueryData<MatchReviewItemRead>(presentKey, (current) =>
				patchPresentCacheOnSuggestionDismiss(current, suggestionId),
			);
			queryClient.setQueryData<TailPagesData>(tailKey, (current) =>
				patchTailCacheOnSuggestionDismiss(current, suggestionId),
			);

			return { previousPresent, previousTail };
		},

		onSuccess: (result, { itemId }, context) => {
			if (!result.success) rollback(itemId, context);
		},

		onError: (error, { itemId }, context) => {
			rollback(itemId, context);
			captureRouteError(error, { route: "match-review-suggestion-dismiss" });
		},
	});
}
