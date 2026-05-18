import { createFileRoute } from "@tanstack/react-router";

import { LikedSongsPage } from "@/features/liked-songs/LikedSongsPage";
import {
	type FilterOption,
	likedSongBySlugQueryOptions,
	likedSongsInfiniteQueryOptions,
} from "@/features/liked-songs/queries";

const SEARCH_FILTER_VALUES = ["all", "pending", "matched", "analyzed"] as const;
type SearchFilter = (typeof SEARCH_FILTER_VALUES)[number];

interface LikedSongsSearch {
	filter: SearchFilter;
	song?: string;
}

function isSearchFilter(value: string): value is SearchFilter {
	return SEARCH_FILTER_VALUES.some((option) => option === value);
}

function validateLikedSongsSearch(
	search: Record<string, unknown>,
): LikedSongsSearch {
	const filter =
		typeof search.filter === "string" && isSearchFilter(search.filter)
			? search.filter
			: "all";
	const song = typeof search.song === "string" ? search.song : undefined;

	return { filter, song };
}

function toQueryFilter(filter: SearchFilter): FilterOption {
	if (filter === "matched") {
		// Older deep links used `matched`; the server filter is now named
		// `has_suggestions`, which is the closest equivalent user-facing state.
		return "has_suggestions";
	}

	return filter;
}

export const Route = createFileRoute("/_authenticated/liked-songs")({
	validateSearch: validateLikedSongsSearch,
	loaderDeps: ({ search }) => ({
		filter: toQueryFilter(search.filter),
		song: search.song,
	}),
	// No precondition guard needed. `/_authenticated` already resolved the
	// session via `resolveSession`; if the user is here and the session is
	// in `song-walkthrough`, the DU guarantees `session.song` is populated.
	// Illegal states (walkthrough without song) are unrepresentable.
	loader: async ({ deps, context }) => {
		await context.queryClient.ensureInfiniteQueryData(
			likedSongsInfiniteQueryOptions(deps.filter),
		);

		if (deps.song) {
			await context.queryClient.ensureQueryData(
				likedSongBySlugQueryOptions(context.session.accountId, deps.song),
			);
		}
	},
	component: LikedSongsRoute,
});

function LikedSongsRoute() {
	// TODO: pass filter to LikedSongsPage when filter UI is built
	const { song } = Route.useSearch();
	const { session, billingState, onboardingSession } = Route.useRouteContext();

	return (
		<LikedSongsPage
			selectedSlug={song}
			accountId={session.accountId}
			billingState={billingState}
			onboardingSession={onboardingSession}
		/>
	);
}
