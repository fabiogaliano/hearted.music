/**
 * Shared hook for Spotify album art
 *
 * Uses hardcoded album art URLs from data.ts for the landing page.
 * No API calls needed - instant loading.
 */
import { songs } from "@/lib/data/mock-data";

interface UseAlbumArtResult {
	/** Whether the album art is still loading (always false with hardcoded data) */
	isLoading: boolean;
	/** Get album art URL for a track */
	getAlbumArt: (spotifyTrackId: string, size?: number) => string;
}

// Build lookup map from songs data
const albumArtMap: Record<string, string> = {};
for (const song of songs) {
	albumArtMap[song.spotifyTrackId] = song.albumArtUrl;
}

export function useAlbumArt(): UseAlbumArtResult {
	const getAlbumArt = (spotifyTrackId: string, _size?: number): string => {
		// Return hardcoded URL or fallback to placeholder
		return (
			albumArtMap[spotifyTrackId] ||
			`https://picsum.photos/seed/${spotifyTrackId}/400/400`
		);
	};

	return { isLoading: false, getAlbumArt };
}
