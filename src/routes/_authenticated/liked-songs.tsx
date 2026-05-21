import { createFileRoute, redirect } from "@tanstack/react-router";

import {
	isSearchFilter,
	type SearchFilter,
	toQueryFilter,
} from "@/features/liked-songs/filter";
import { LikedSongsPage } from "@/features/liked-songs/LikedSongsPage";
import {
	likedSongBySlugQueryOptions,
	likedSongsInfiniteQueryOptions,
} from "@/features/liked-songs/queries";

type UrlSearchFilter = Exclude<SearchFilter, "all">;

interface LikedSongsSearch {
	filter?: UrlSearchFilter;
	song?: string;
}

const DEFAULT_FILTER = "all" satisfies SearchFilter;

function toUrlFilter(filter: SearchFilter): UrlSearchFilter | undefined {
	return filter === DEFAULT_FILTER ? undefined : filter;
}

function hasDefaultFilterParam(searchStr: string): boolean {
	return new URLSearchParams(searchStr).get("filter") === DEFAULT_FILTER;
}

function validateLikedSongsSearch(
	search: Record<string, unknown>,
): LikedSongsSearch {
	const filter =
		typeof search.filter === "string" && isSearchFilter(search.filter)
			? toUrlFilter(search.filter)
			: undefined;
	const song = typeof search.song === "string" ? search.song : undefined;

	return { filter, song };
}

export const Route = createFileRoute("/_authenticated/liked-songs")({
	validateSearch: validateLikedSongsSearch,
	beforeLoad: ({ location, search }) => {
		if (hasDefaultFilterParam(location.searchStr)) {
			throw redirect({
				to: "/liked-songs",
				search: { song: search.song },
				replace: true,
			});
		}
	},
	loaderDeps: ({ search }) => ({
		filter: toQueryFilter(search.filter ?? DEFAULT_FILTER),
		song: search.song,
	}),
	// No precondition guard needed. `/_authenticated` already resolved the
	// session via `resolveSession`; if the user is here and the session is
	// in `song-walkthrough`, the DU guarantees `session.song` is populated.
	// Illegal states (walkthrough without song) are unrepresentable.
	loader: async ({ deps, context }) => {
		await context.queryClient.ensureInfiniteQueryData(
			likedSongsInfiniteQueryOptions(deps.filter, undefined),
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
	const { filter, song } = Route.useSearch();
	const activeFilter = filter ?? DEFAULT_FILTER;
	const { session, billingState, onboardingSession } = Route.useRouteContext();
	const navigate = Route.useNavigate();

	return (
		<LikedSongsPage
			filter={activeFilter}
			onFilterChange={(next) =>
				navigate({
					search: (prev) => ({ ...prev, filter: toUrlFilter(next) }),
					replace: true,
				})
			}
			selectedSlug={song}
			accountId={session.accountId}
			billingState={billingState}
			onboardingSession={onboardingSession}
		/>
	);
}
