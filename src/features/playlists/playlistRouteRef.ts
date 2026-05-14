import type { Playlist } from "@/lib/domains/library/playlists/queries";

const PLAYLIST_ROUTE_ID_PREFIX_LENGTH = 12;

function slugifyPlaylistName(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80);

	return slug.length > 0 ? slug : "playlist";
}

function normalizePlaylistId(id: string): string {
	return id.replace(/-/g, "").toLowerCase();
}

function playlistIdPrefix(id: string): string {
	return normalizePlaylistId(id).slice(0, PLAYLIST_ROUTE_ID_PREFIX_LENGTH);
}

function parsePlaylistRouteRef(
	playlistRef: string,
): { slug: string; idPrefix: string } | null {
	const match = playlistRef
		.toLowerCase()
		.match(/^(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)--(?<idPrefix>[a-f0-9]{12})$/);

	if (!match?.groups) {
		return null;
	}

	return {
		slug: match.groups.slug,
		idPrefix: match.groups.idPrefix,
	};
}

export function buildPlaylistRouteRef(playlist: Playlist): string {
	return `${slugifyPlaylistName(playlist.name)}--${playlistIdPrefix(playlist.id)}`;
}

export function resolvePlaylistIdFromRouteRef(
	playlists: readonly Playlist[],
	playlistRef: string | null | undefined,
): string | null {
	if (!playlistRef) {
		return null;
	}

	const parsed = parsePlaylistRouteRef(playlistRef);
	if (!parsed) {
		return null;
	}

	const prefixMatches = playlists.filter((playlist) =>
		normalizePlaylistId(playlist.id).startsWith(parsed.idPrefix),
	);

	if (prefixMatches.length === 1) {
		return prefixMatches[0].id;
	}

	if (prefixMatches.length === 0) {
		return null;
	}

	const slugMatches = prefixMatches.filter(
		(playlist) => slugifyPlaylistName(playlist.name) === parsed.slug,
	);

	return slugMatches.length === 1 ? slugMatches[0].id : null;
}
