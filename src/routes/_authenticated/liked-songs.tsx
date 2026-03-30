import { createFileRoute } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { LikedSongsPage } from "@/features/liked-songs/LikedSongsPage";
import {
	likedSongBySlugQueryOptions,
	likedSongsInfiniteQueryOptions,
} from "@/features/liked-songs/queries";

const searchSchema = z.object({
	filter: fallback(z.enum(["all", "pending", "matched", "analyzed"]), "all"),
	song: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/liked-songs")({
	validateSearch: zodValidator(searchSchema),
	loaderDeps: ({ search }) => ({ filter: search.filter, song: search.song }),
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
	const { session } = Route.useRouteContext();

	return <LikedSongsPage selectedSlug={song} accountId={session.accountId} />;
}
