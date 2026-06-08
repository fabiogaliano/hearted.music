import { type InfiniteData, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { WalkthroughSong } from "@/features/onboarding/step-resolver";
import type { SongDisplayState } from "@/lib/domains/billing/state";
import type { LikedSongsPageResult } from "@/lib/server/liked-songs.functions";
import { type FilterOption, likedSongsInfiniteQueryOptions } from "../queries";
import type { LikedSong } from "../types";

interface UseLikedSongsCollectionOptions {
	filter: FilterOption;
	search?: string;
	isWalkthrough: boolean;
	walkthroughSong: WalkthroughSong | null;
}

const UNSETTLED_POLL_MS = 5_000;

// A row is "unsettled" while its analysis is still in flight: `pending` and
// `analyzing` are exactly the states that render the live "Listening" UI.
// `analyzed`, `failed`, and `locked` are terminal — once every loaded row is in
// one of those, there is nothing left to converge on, so polling can stop.
const UNSETTLED_DISPLAY_STATES: ReadonlySet<SongDisplayState> = new Set([
	"pending",
	"analyzing",
]);

function hasUnsettledLoadedSong(
	data: InfiniteData<LikedSongsPageResult> | undefined,
): boolean {
	if (!data) return false;
	return data.pages.some((page) =>
		page.songs.some((song) => UNSETTLED_DISPLAY_STATES.has(song.displayState)),
	);
}

/**
 * Polling cadence for the liked-songs collection. Returns ~5s while any loaded
 * row is still mid-analysis and `false` once every loaded row is settled, so
 * the collection self-heals even when the active-jobs completion transition is
 * missed (see useLikedSongsCollection).
 */
export function likedSongsCollectionRefetchInterval(
	data: InfiniteData<LikedSongsPageResult> | undefined,
): number | false {
	return hasUnsettledLoadedSong(data) ? UNSETTLED_POLL_MS : false;
}

function buildSyntheticLikedSong(ws: WalkthroughSong): LikedSong {
	return {
		liked_at: new Date().toISOString(),
		matching_status: null,
		displayState: "analyzed",
		analysis: ws.analysis
			? {
					id: ws.analysis.id,
					track_id: ws.id,
					analysis: ws.analysis.content,
					model_name: ws.analysis.model,
					version: 1,
					created_at: ws.analysis.createdAt,
				}
			: null,
		track: {
			id: ws.id,
			spotify_track_id: ws.spotifyTrackId,
			name: ws.name,
			artist: ws.artist,
			artist_id: ws.artistId,
			artist_image_url: ws.artistImageUrl,
			album: ws.album,
			image_url: ws.albumArtUrl,
			genres: ws.genres,
			audio_features: null,
		},
	};
}

export function useLikedSongsCollection({
	filter,
	search,
	isWalkthrough,
	walkthroughSong,
}: UseLikedSongsCollectionOptions) {
	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
		useInfiniteQuery({
			...likedSongsInfiniteQueryOptions(filter, search),
			// Robustness layer on top of useActiveJobCompletionEffects: while any
			// loaded row is still mid-analysis, poll the collection itself so the
			// row converges to its analyzed read even when the active-jobs
			// true -> false completion transition is missed (backgrounded tab, or
			// the job finishing between active-jobs polls). Stops the moment every
			// loaded row is settled, so a fully-analyzed list never polls.
			refetchInterval: (query) =>
				likedSongsCollectionRefetchInterval(query.state.data),
		});

	const songs = useMemo(
		() => data?.pages.flatMap((page) => page.songs) ?? [],
		[data?.pages],
	);

	const displayedSongs = useMemo(() => {
		if (!isWalkthrough || !walkthroughSong) return songs;

		const realSong = songs.find((song) => song.track.id === walkthroughSong.id);
		const syntheticSong = buildSyntheticLikedSong(walkthroughSong);
		const demoSong: LikedSong = realSong
			? {
					...realSong,
					displayState: "analyzed",
					analysis: realSong.analysis ?? syntheticSong.analysis,
				}
			: syntheticSong;
		const dedupedSongs = songs.filter(
			(song) => song.track.id !== walkthroughSong.id,
		);

		return [demoSong, ...dedupedSongs];
	}, [isWalkthrough, songs, walkthroughSong]);

	const displayedSongIndexById = useMemo(
		() => new Map(displayedSongs.map((song, index) => [song.track.id, index])),
		[displayedSongs],
	);

	return {
		isLoading,
		displayedSongs,
		displayedSongIndexById,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
	};
}
