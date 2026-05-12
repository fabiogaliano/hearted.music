import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { generateSongSlug } from "@/lib/utils/slug";
import { likedSongBySlugQueryOptions } from "../queries";
import type { LikedSong } from "../types";

interface UseSelectedLikedSongBySlugOptions {
	accountId: string;
	displayedSongs: readonly LikedSong[];
	selectedSlug?: string | null;
}

function findSongForSlug(
	songs: readonly LikedSong[],
	slug: string | null | undefined,
): LikedSong | null {
	if (!slug) {
		return null;
	}

	return (
		songs.find(
			(candidate) =>
				generateSongSlug(candidate.track.artist, candidate.track.name) === slug,
		) ?? null
	);
}

export function useSelectedLikedSongBySlug({
	accountId,
	displayedSongs,
	selectedSlug,
}: UseSelectedLikedSongBySlugOptions) {
	const selectedSongFromLoadedPages = useMemo(
		() => findSongForSlug(displayedSongs, selectedSlug),
		[displayedSongs, selectedSlug],
	);
	const shouldFetchSelectedSongBySlug =
		selectedSlug != null && selectedSongFromLoadedPages === null;
	const {
		data: selectedSongFromSlugLookup,
		isPending: isSelectedSongSlugLookupPending,
	} = useQuery({
		...likedSongBySlugQueryOptions(accountId, selectedSlug),
		enabled: shouldFetchSelectedSongBySlug,
	});
	const selectedSongFromUrl =
		selectedSongFromLoadedPages ?? selectedSongFromSlugLookup ?? null;
	const isSelectedSlugResolved =
		selectedSlug == null ||
		selectedSongFromLoadedPages !== null ||
		!shouldFetchSelectedSongBySlug ||
		!isSelectedSongSlugLookupPending;

	return {
		selectedSongFromUrl,
		selectedSongIdFromUrl: selectedSongFromUrl?.track.id ?? null,
		isSelectedSlugResolved,
	};
}
