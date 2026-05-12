import { useQuery } from "@tanstack/react-query";
import type { WalkthroughSong } from "@/features/onboarding/step-resolver";
import { type FilterOption, likedSongsStatsQueryOptions } from "../queries";
import { useLikedSongsCollection } from "./useLikedSongsCollection";
import { useSelectedLikedSongBySlug } from "./useSelectedLikedSongBySlug";

interface UseLikedSongsPageDataOptions {
	accountId: string;
	filter: FilterOption;
	selectedSlug?: string | null;
	isWalkthrough: boolean;
	walkthroughSong: WalkthroughSong | null;
	isEnrichmentRunning: boolean;
}

export function useLikedSongsPageData({
	accountId,
	filter,
	selectedSlug,
	isWalkthrough,
	walkthroughSong,
	isEnrichmentRunning,
}: UseLikedSongsPageDataOptions) {
	const {
		isLoading,
		displayedSongs,
		displayedSongIndexById,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	} = useLikedSongsCollection({
		filter,
		isWalkthrough,
		walkthroughSong,
	});

	const { selectedSongFromUrl, selectedSongIdFromUrl, isSelectedSlugResolved } =
		useSelectedLikedSongBySlug({
			accountId,
			displayedSongs,
			selectedSlug,
		});

	const { data: stats } = useQuery({
		...likedSongsStatsQueryOptions(accountId),
		refetchInterval: isEnrichmentRunning ? 5_000 : undefined,
	});

	return {
		isLoading,
		displayedSongs,
		displayedSongIndexById,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		selectedSongFromUrl,
		selectedSongIdFromUrl,
		isSelectedSlugResolved,
		stats,
	};
}
