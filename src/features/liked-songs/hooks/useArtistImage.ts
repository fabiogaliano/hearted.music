import { useQuery } from "@tanstack/react-query";

import { queryArtistOverview } from "@/lib/extension/spotify-client";

import { likedSongsKeys } from "../queries";

interface UseArtistImageOptions {
	enabled?: boolean;
}

interface UseArtistImageResult {
	artistImageUrl: string | undefined;
	isLoading: boolean;
}

async function fetchArtistImage(artistId: string): Promise<string | null> {
	const artistUri = `spotify:artist:${artistId}`;
	const extensionResult = await queryArtistOverview(artistUri);
	if (!extensionResult.ok) throw new Error("Extension unavailable");

	const images = extensionResult.data.avatarImages;
	if (images.length === 0) return null;

	const best = images.reduce((a, b) => (a.width > b.width ? a : b));
	return best.url;
}

export function useArtistImage(
	artistId: string | null | undefined,
	options: UseArtistImageOptions = {},
): UseArtistImageResult {
	const { enabled = true } = options;

	const query = useQuery({
		queryKey: likedSongsKeys.artistImage(artistId || ""),
		queryFn: () => fetchArtistImage(artistId!),
		enabled: enabled && !!artistId,
		staleTime: 1000 * 60 * 60,
		gcTime: 1000 * 60 * 60 * 24,
		retry: 1,
	});

	return {
		artistImageUrl: query.data ?? undefined,
		isLoading: query.isLoading,
	};
}
