import { createFileRoute } from "@tanstack/react-router";
import { resolvePlaylistIdFromRouteRef } from "@/features/playlists/playlistRouteRef";
import {
	playlistManagementQueryOptions,
	playlistTracksInfiniteQueryOptions,
} from "@/features/playlists/queries";

// This route exists only so /playlists/$playlistRef matches and contributes
// the playlistRef param. Rendering lives on the parent route (playlists.tsx),
// which keeps PlaylistsScreen mounted across navigations between the list and
// detail URLs. The loader soft-prefetches the first page of tracks so direct
// links hydrate without a visible loading flash; failure must not block the
// playlist shell from rendering.
export const Route = createFileRoute("/_authenticated/playlists/$playlistRef")({
	loader: async ({ context, params }) => {
		const accountId = context.session.accountId;

		const data = await context.queryClient.ensureQueryData(
			playlistManagementQueryOptions(accountId),
		);

		const playlistId = resolvePlaylistIdFromRouteRef(
			data.playlists,
			params.playlistRef,
		);

		if (playlistId === null) {
			return;
		}

		try {
			await context.queryClient.fetchInfiniteQuery(
				playlistTracksInfiniteQueryOptions(playlistId),
			);
		} catch (error) {
			console.warn("Failed to prefetch playlist tracks", {
				playlistId,
				error,
			});
		}
	},
	component: () => null,
});
