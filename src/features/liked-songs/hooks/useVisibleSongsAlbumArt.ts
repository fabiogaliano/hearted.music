/**
 * Hook: useVisibleSongsAlbumArt
 *
 * Fetches album art only for currently visible/rendered songs.
 * Uses TanStack Query for caching and deduplication.
 * Batches requests in groups of 50 (API limit).
 */
import { useCallback, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { LikedSong } from "../types";

const BATCH_SIZE = 50;

export const albumArtKeys = {
	all: ["album-art"] as const,
	batch: (ids: string[]) =>
		["album-art", "batch", ids.sort().join(",")] as const,
};

const getPlaceholder = (spotifyTrackId: string, size = 400): string =>
	`https://picsum.photos/seed/${spotifyTrackId}/${size}/${size}`;

async function fetchAlbumArtBatch(
	trackIds: string[],
): Promise<Record<string, string>> {
	if (trackIds.length === 0) return {};

	const idsParam = trackIds.join(",");
	const res = await fetch(`/api/track-images?ids=${idsParam}`);

	if (!res.ok) {
		throw new Error(`Failed to fetch album art: ${res.status}`);
	}

	const data = await res.json();
	return data.images || {};
}

interface UseVisibleSongsAlbumArtResult {
	albumArt: Record<string, string>;
	isLoading: boolean;
	getAlbumArt: (spotifyTrackId: string) => string;
}

export function useVisibleSongsAlbumArt(
	visibleSongs: LikedSong[],
): UseVisibleSongsAlbumArtResult {
	const trackIds = useMemo(
		() => [...new Set(visibleSongs.map((s) => s.track.spotify_id))],
		[visibleSongs],
	);

	const batches = useMemo(() => {
		const result: string[][] = [];
		for (let i = 0; i < trackIds.length; i += BATCH_SIZE) {
			result.push(trackIds.slice(i, i + BATCH_SIZE));
		}
		return result;
	}, [trackIds]);

	const queries = useQueries({
		queries: batches.map((batch) => ({
			queryKey: albumArtKeys.batch(batch),
			queryFn: () => fetchAlbumArtBatch(batch),
			staleTime: 1000 * 60 * 60,
			gcTime: 1000 * 60 * 60 * 2,
			retry: 2,
		})),
	});

	const albumArt = useMemo(() => {
		const merged: Record<string, string> = {};
		for (const q of queries) {
			if (q.data) {
				Object.assign(merged, q.data);
			}
		}
		return merged;
	}, [queries]);

	const isLoading = queries.some((q) => q.isLoading);

	const getAlbumArt = useCallback(
		(spotifyTrackId: string): string => {
			return albumArt[spotifyTrackId] || getPlaceholder(spotifyTrackId);
		},
		[albumArt],
	);

	return { albumArt, isLoading, getAlbumArt };
}
