import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolvePlaylistIdFromRouteRef } from "@/features/playlists/playlistRouteRef";
import {
	playlistManagementQueryOptions,
	playlistTracksInfiniteQueryOptions,
} from "@/features/playlists/queries";

// This route exists only so /playlists/$playlistRef matches and contributes
// the playlistRef param. Rendering lives on the parent route (playlists.tsx),
// which keeps PlaylistsCoverFlowScreen mounted across navigations between the
// list and detail URLs. The loader soft-prefetches the first page of tracks so
// direct links hydrate without a visible loading flash; failure must not block
// the playlist shell from rendering.
export const Route = createFileRoute("/_authenticated/playlists/$playlistRef")({
	loader: async ({ context, params }) => {
		const accountId = context.session.accountId;

		// Route-resolution guards must read fresh playlist data so recently
		// added/removed playlists do not leave deep links on stale decisions.
		const data = await context.queryClient.fetchQuery({
			...playlistManagementQueryOptions(accountId),
			staleTime: 0,
		});

		const playlistId = resolvePlaylistIdFromRouteRef(
			data.playlists,
			params.playlistRef,
		);

		// Unresolved refs (malformed, stale, unknown prefix, ambiguous, or
		// belonging to another account) get cleaned up by sending the user
		// back to the list URL rather than leaving a misleading detail URL.
		if (playlistId === null) {
			throw redirect({ to: "/playlists", replace: true });
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
