import { createFileRoute } from "@tanstack/react-router";

// This route exists only so /playlists/$playlistRef matches and contributes
// the playlistRef param. Rendering and data loading live on the parent route
// (playlists.tsx), which keeps PlaylistsScreen mounted across navigations
// between the list and detail URLs.
export const Route = createFileRoute("/_authenticated/playlists/$playlistRef")({
	component: () => null,
});
