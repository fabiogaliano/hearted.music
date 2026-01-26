/**
 * Hook: useArtistImage
 *
 * Fetches artist image for a single track (for atmospheric backgrounds).
 * Uses TanStack Query for caching - once fetched, stays cached.
 *
 * Only fetches when a track ID is provided and the detail view is expanded.
 * Uses app-level Spotify authentication (no user login required).
 */
import { useQuery } from '@tanstack/react-query'

// Query key factory
export const artistImageKeys = {
	all: ['artist-image'] as const,
	forTrack: (trackId: string) => ['artist-image', 'track', trackId] as const,
}

// Fetch function
async function fetchArtistImageForTrack(trackId: string): Promise<string | null> {
	const res = await fetch(`/api/artist-images-for-tracks?ids=${trackId}`)

	if (!res.ok) {
		// Don't throw - artist image is optional/decorative
		console.warn('Failed to fetch artist image:', res.status)
		return null
	}

	const data = await res.json()
	return data.images?.[trackId] || null
}

interface UseArtistImageOptions {
	/** Whether to enable fetching (e.g., only when detail view is expanded) */
	enabled?: boolean
}

interface UseArtistImageResult {
	/** Artist image URL, or undefined if loading/not available */
	artistImageUrl: string | undefined
	/** Whether the image is still loading */
	isLoading: boolean
}

/**
 * Fetch artist image for a track's primary artist
 *
 * @param spotifyTrackId - The Spotify track ID
 * @param options - { enabled: boolean } - Only fetch when enabled
 */
export function useArtistImage(
	spotifyTrackId: string | undefined,
	options: UseArtistImageOptions = {}
): UseArtistImageResult {
	const { enabled = true } = options

	const query = useQuery({
		queryKey: artistImageKeys.forTrack(spotifyTrackId || ''),
		queryFn: () => fetchArtistImageForTrack(spotifyTrackId!),
		enabled: enabled && !!spotifyTrackId,
		staleTime: 1000 * 60 * 60, // 1 hour - artist images don't change often
		gcTime: 1000 * 60 * 60 * 24, // 24 hours cache
		retry: 1, // Only retry once - it's decorative
	})

	return {
		artistImageUrl: query.data ?? undefined,
		isLoading: query.isLoading,
	}
}
