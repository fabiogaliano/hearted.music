import { useQuery } from "@tanstack/react-query";
import type { WalkthroughSong } from "@/lib/domains/library/accounts/onboarding-session";
import {
	accountEventsConnectionKey,
	type ConnectionState,
} from "@/lib/hooks/useAccountEvents";
import { type FilterOption, likedSongsStatsQueryOptions } from "../queries";
import { useLikedSongsCollection } from "./useLikedSongsCollection";
import { useSelectedLikedSongBySlug } from "./useSelectedLikedSongBySlug";

interface UseLikedSongsPageDataOptions {
	accountId: string;
	filter: FilterOption;
	search?: string;
	selectedSlug?: string | null;
	isWalkthrough: boolean;
	walkthroughSong: WalkthroughSong | null;
	companionSongs?: readonly WalkthroughSong[];
	isEnrichmentRunning: boolean;
}

export function likedSongsStatsRefetchInterval(
	isEnrichmentRunning: boolean,
	connectionState: ConnectionState,
): number | false {
	if (!isEnrichmentRunning || connectionState === "connected") return false;
	return 5_000;
}

export function useLikedSongsPageData({
	accountId,
	filter,
	search,
	selectedSlug,
	isWalkthrough,
	walkthroughSong,
	companionSongs,
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
		accountId,
		filter,
		search,
		isWalkthrough,
		walkthroughSong,
		companionSongs,
	});

	const { selectedSongFromUrl, selectedSongIdFromUrl, isSelectedSlugResolved } =
		useSelectedLikedSongBySlug({
			accountId,
			displayedSongs,
			selectedSlug,
		});
	const { data: connectionState } = useQuery<ConnectionState>({
		queryKey: accountEventsConnectionKey(accountId),
		queryFn: () => "disconnected",
		initialData: "disconnected",
		staleTime: Number.POSITIVE_INFINITY,
	});

	const { data: stats } = useQuery({
		...likedSongsStatsQueryOptions(accountId),
		refetchInterval: likedSongsStatsRefetchInterval(
			isEnrichmentRunning,
			connectionState,
		),
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
