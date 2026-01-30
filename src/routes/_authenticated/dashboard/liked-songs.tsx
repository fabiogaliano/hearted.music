/**
 * /dashboard/liked-songs - Liked Songs browsing page
 *
 * Displays user's liked songs library with filtering and detail panel.
 * Supports deep linking via URL slug: /dashboard/liked-songs?song={slug}
 *
 * URL params:
 * - filter: 'all' | 'unsorted' | 'sorted' | 'analyzed'
 * - song: slug for deep linking to specific song
 */

import { createFileRoute } from "@tanstack/react-router";
import { getLikedSongsPage } from "@/lib/server/liked-songs.server";
import { LikedSongsPage } from "@/features/liked-songs/LikedSongsPage";
import type { FilterOption } from "@/features/liked-songs/types";

export const Route = createFileRoute("/_authenticated/dashboard/liked-songs")({
	validateSearch: (search: Record<string, unknown>) => {
		const filter = search.filter as string | undefined;
		const validFilters = ["all", "unsorted", "sorted", "analyzed"];
		return {
			filter:
				filter && validFilters.includes(filter)
					? (filter as FilterOption)
					: ("all" as FilterOption),
			song: typeof search.song === "string" ? search.song : undefined,
		};
	},
	loaderDeps: ({ search }) => ({ filter: search.filter }),
	loader: async ({ deps }) => {
		const result = await getLikedSongsPage({
			data: {
				cursor: 0,
				limit: 50,
				filter: deps.filter as FilterOption,
			},
		});
		return result;
	},
	component: LikedSongsRoute,
});

function LikedSongsRoute() {
	const search = Route.useSearch();
	const loaderData = Route.useLoaderData();

	return (
		<LikedSongsPage
			songs={loaderData?.songs ?? []}
			initialFilter={search.filter}
			selectedSlug={search.song ?? null}
		/>
	);
}
