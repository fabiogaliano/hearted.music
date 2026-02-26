/**
 * Hook: useArtistImage
 *
 * Fetches artist image by Spotify artist ID (for atmospheric backgrounds).
 * Uses TanStack Query for caching - once fetched, stays cached.
 *
 * Cache key is by artistId, enabling 100% deduplication across tracks
 * from the same artist (e.g., 3 Kendrick songs = 1 API call, not 6).
 */
import { useQuery } from "@tanstack/react-query";

import { getArtistImageById } from "@/lib/server/liked-songs.functions";

import { likedSongsKeys } from "../queries";

interface UseArtistImageOptions {
	enabled?: boolean;
}

interface UseArtistImageResult {
	artistImageUrl: string | undefined;
	isLoading: boolean;
}

/**
 * Fetch artist image by Spotify artist ID
 *
 * @param artistId - The Spotify artist ID (from track.artist_id)
 * @param options - { enabled: boolean } - Only fetch when enabled
 */
export function useArtistImage(
	artistId: string | null | undefined,
	options: UseArtistImageOptions = {},
): UseArtistImageResult {
	const { enabled = true } = options;

	const query = useQuery({
		queryKey: likedSongsKeys.artistImage(artistId || ""),
		queryFn: () => getArtistImageById({ data: { artistId: artistId! } }),
		enabled: enabled && !!artistId,
		staleTime: 1000 * 60 * 60,
		gcTime: 1000 * 60 * 60 * 24,
		retry: 1,
	});

	return {
		artistImageUrl: query.data?.url ?? undefined,
		isLoading: query.isLoading,
	};
}
