import { createFileRoute, redirect } from "@tanstack/react-router";

import {
	isSearchFilter,
	type SearchFilter,
	toQueryFilter,
} from "@/features/liked-songs/filter";
import { LikedSongsPage } from "@/features/liked-songs/LikedSongsPage";
import {
	likedSongBySlugQueryOptions,
	likedSongsDeepLinkBootstrapQueryOptions,
	likedSongsInfiniteQueryOptions,
	resolveLikedSongsDeepLinkBootstrap,
	seedLikedSongsDeepLinkCaches,
	walkthroughCompanionsQueryOptions,
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
	loaderDeps: ({ search }) => {
		// `locked` projects to the `all` query filter, so the raw UI filter is
		// kept alongside the query filter — the bootstrap decision below must not
		// fire for `locked`, where the selected song may legitimately be absent.
		const uiFilter = search.filter ?? DEFAULT_FILTER;
		return {
			uiFilter,
			queryFilter: toQueryFilter(uiFilter),
			song: search.song,
		};
	},
	// No precondition guard needed. `/_authenticated` already resolved the
	// session via `resolveSession`; if the user is here and the session is
	// in `song-walkthrough`, the DU guarantees `session.song` is populated.
	// Illegal states (walkthrough without song) are unrepresentable.
	loader: async ({ deps, context }) => {
		// Song-walkthrough runs pre-sync: prefetch the curated companion songs so
		// the library renders the full 6-song demo set without a pop-in after the
		// hero. Static demo data, so this is cached forever after the first load.
		if (context.onboardingSession.status === "song-walkthrough") {
			await context.queryClient.ensureQueryData(
				walkthroughCompanionsQueryOptions(),
			);
		}

		// Deep link into the default (unfiltered, no-search) list: bootstrap the
		// list cache with the contiguous prefix through the selected song so a
		// cold reload renders it in-list (highlighted, scroll-centered,
		// prev/next-navigable) without a client-side page waterfall. Filtered
		// views (`pending`/`analyzed`/`locked`) keep the existing behavior since
		// the selected song may not belong to the filtered set.
		//
		// Gated by `resolveLikedSongsDeepLinkBootstrap(...)`: once this page is
		// already live, later in-app song changes re-run the loader with a new
		// `song`, but must not reseed the canonical list. Fresh entries can still
		// bootstrap when the selected song is not already in the warm cache.
		const bootstrapTarget = resolveLikedSongsDeepLinkBootstrap(
			context.queryClient,
			{ song: deps.song, isDefaultFilter: deps.uiFilter === DEFAULT_FILTER },
		);
		if (bootstrapTarget) {
			try {
				const bootstrap = await context.queryClient.ensureQueryData(
					likedSongsDeepLinkBootstrapQueryOptions(
						context.session.accountId,
						bootstrapTarget.slug,
					),
				);
				seedLikedSongsDeepLinkCaches(
					context.queryClient,
					context.session.accountId,
					bootstrapTarget.slug,
					bootstrap,
				);
				return;
			} catch {
				// Bootstrap failed (transient server/DB error): fall through to the
				// normal first-page load below so the library still renders instead
				// of hydrating empty. The by-slug fallback still opens the panel.
			}
		}

		await context.queryClient.ensureInfiniteQueryData(
			likedSongsInfiniteQueryOptions(deps.queryFilter, undefined),
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
