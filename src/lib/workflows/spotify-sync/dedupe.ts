/**
 * Deduplicates tracks by spotify_id, keeping first occurrence.
 *
 * Business rule: Spotify allows duplicate songs in playlists; we keep first occurrence only.
 * Also filters out null tracks (local files, deleted tracks).
 */
export function dedupeTracksBySpotifyId<
	T extends { track: { id: string } | null },
>(tracks: T[]): T[] {
	const seen = new Set<string>();
	return tracks.filter((t): t is T & { track: { id: string } } => {
		if (!t.track) return false;
		if (seen.has(t.track.id)) return false;
		seen.add(t.track.id);
		return true;
	});
}
