import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { WalkthroughSong } from "@/features/onboarding/step-resolver";
import { type FilterOption, likedSongsInfiniteQueryOptions } from "../queries";
import type { LikedSong } from "../types";

interface UseLikedSongsCollectionOptions {
	filter: FilterOption;
	isWalkthrough: boolean;
	walkthroughSong: WalkthroughSong | null;
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
	isWalkthrough,
	walkthroughSong,
}: UseLikedSongsCollectionOptions) {
	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
		useInfiniteQuery(likedSongsInfiniteQueryOptions(filter));

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
