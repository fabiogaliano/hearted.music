import { createAdminSupabaseClient } from "@/lib/data/client";

/**
 * Builds a set of "songId:playlistId" keys representing pairs that should be
 * skipped during matching — either because the user already made a decision
 * or because the song is already in the playlist.
 */
export async function loadExclusionSet(
	accountId: string,
): Promise<Set<string>> {
	const supabase = createAdminSupabaseClient();
	const exclusions = new Set<string>();

	// Load all match_decision rows for this account
	const { data: decisions } = await supabase
		.from("match_decision")
		.select("song_id, playlist_id")
		.eq("account_id", accountId);

	if (decisions) {
		for (const d of decisions) {
			exclusions.add(`${d.song_id}:${d.playlist_id}`);
		}
	}

	// Load playlist IDs for this account
	const { data: playlists } = await supabase
		.from("playlist")
		.select("id")
		.eq("account_id", accountId);

	if (playlists && playlists.length > 0) {
		const playlistIds = playlists.map((p) => p.id);

		// Load playlist_song rows for those playlists
		const { data: playlistSongs } = await supabase
			.from("playlist_song")
			.select("song_id, playlist_id")
			.in("playlist_id", playlistIds);

		if (playlistSongs) {
			for (const ps of playlistSongs) {
				exclusions.add(`${ps.song_id}:${ps.playlist_id}`);
			}
		}
	}

	return exclusions;
}
