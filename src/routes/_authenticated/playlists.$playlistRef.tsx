import type { QueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { resolvePlaylistIdFromRouteRef } from "@/features/playlists/playlistRouteRef";
import {
	playlistManagementQueryOptions,
	playlistTracksInfiniteQueryOptions,
} from "@/features/playlists/queries";
import { PLAYLIST_NOT_FOUND_MESSAGE } from "@/lib/server/playlists.functions";

// This route exists only so /playlists/$playlistRef matches and contributes
// the playlistRef param. Rendering lives on the parent route (playlists.tsx),
// which keeps PlaylistsCoverFlowScreen mounted across navigations between the
// list and detail URLs. The loader soft-prefetches the first page of tracks so
// direct links hydrate without a visible loading flash; failure must not block
// the playlist shell from rendering.
export const Route = createFileRoute("/_authenticated/playlists/$playlistRef")({
	loader: async ({ context, params }) => {
		const { queryClient } = context;
		const management = playlistManagementQueryOptions(
			context.session.accountId,
		);

		const toList = () => redirect({ to: "/playlists", replace: true });

		// The parent /playlists loader already holds the management data, so the
		// cache resolves almost every ref and the tracks read starts without a
		// management round trip. The cache can be stale (playlists added or
		// removed since it loaded), so a miss or a cached playlist the server says
		// is gone is settled against fresh data instead of trusted.
		const wasCached =
			queryClient.getQueryData(management.queryKey) !== undefined;
		const cached = await queryClient.ensureQueryData(management);
		const cachedId = resolvePlaylistIdFromRouteRef(
			cached.playlists,
			params.playlistRef,
		);

		if (cachedId !== null) {
			if ((await prefetchTracks(queryClient, cachedId)) === "done") return;
			// Refresh so the list the user lands on no longer shows it.
			await queryClient.fetchQuery({ ...management, staleTime: 0 });
			throw toList();
		}

		// Unresolved refs (malformed, stale, unknown prefix, ambiguous, or
		// belonging to another account) get cleaned up by sending the user
		// back to the list URL rather than leaving a misleading detail URL. A
		// cache that was empty was just fetched, so it isn't re-read.
		if (!wasCached) throw toList();
		const fresh = await queryClient.fetchQuery({ ...management, staleTime: 0 });
		const playlistId = resolvePlaylistIdFromRouteRef(
			fresh.playlists,
			params.playlistRef,
		);
		if (playlistId === null) throw toList();
		await prefetchTracks(queryClient, playlistId);
	},
	component: () => null,
});

async function prefetchTracks(
	queryClient: QueryClient,
	playlistId: string,
): Promise<"done" | "playlist-gone"> {
	try {
		await queryClient.fetchInfiniteQuery(
			playlistTracksInfiniteQueryOptions(playlistId),
		);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === PLAYLIST_NOT_FOUND_MESSAGE
		) {
			return "playlist-gone";
		}
		console.warn("Failed to prefetch playlist tracks", { playlistId, error });
	}
	return "done";
}
