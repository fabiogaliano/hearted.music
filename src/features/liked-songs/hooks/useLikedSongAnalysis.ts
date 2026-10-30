import { useQuery } from "@tanstack/react-query";
import type { StoredAnalysis } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { likedSongAnalysisQueryOptions } from "../queries";
import {
	hasStoredAnalysis,
	type LikedSong,
	type SongAnalysisState,
} from "../types";

const NO_ANALYSIS: SongAnalysisState = { status: "loaded", analysis: null };
const LOADING: SongAnalysisState = { status: "loading" };

/**
 * The selected song's analysis for the detail panel. Walkthrough songs carry
 * theirs in the onboarding session (most aren't liked by the account, so the
 * server has nothing for them); other analyzed songs are read per song.
 */
export function useLikedSongAnalysis(
	accountId: string,
	song: LikedSong | null,
	walkthroughAnalysisById: ReadonlyMap<string, StoredAnalysis>,
): SongAnalysisState {
	// Locked first: whatever else is cached for this song, a locked row shows
	// no read.
	const walkthroughAnalysis =
		song && song.displayState !== "locked"
			? walkthroughAnalysisById.get(song.track.id)
			: undefined;
	const shouldRead =
		song !== null &&
		walkthroughAnalysis === undefined &&
		hasStoredAnalysis(song);
	const { data, isPending } = useQuery({
		...likedSongAnalysisQueryOptions(accountId, song?.track.id ?? null),
		enabled: shouldRead,
	});

	if (walkthroughAnalysis) {
		return { status: "loaded", analysis: walkthroughAnalysis };
	}
	if (!shouldRead) return NO_ANALYSIS;
	if (isPending) return LOADING;
	return { status: "loaded", analysis: data ?? null };
}
