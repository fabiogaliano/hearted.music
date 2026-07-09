import {
	type InfiniteData,
	useInfiniteQuery,
	useQuery,
} from "@tanstack/react-query";
import { useMemo } from "react";
import type { SongDisplayState } from "@/lib/domains/billing/state";
import type { WalkthroughSong } from "@/lib/domains/library/accounts/onboarding-session";
import {
	accountEventsConnectionKey,
	type ConnectionState,
} from "@/lib/hooks/useAccountEvents";
import type { LikedSongsPageResult } from "@/lib/server/liked-songs.functions";
import { type FilterOption, likedSongsInfiniteQueryOptions } from "../queries";
import type { LikedSong } from "../types";

interface UseLikedSongsCollectionOptions {
	accountId: string;
	filter: FilterOption;
	search?: string;
	isWalkthrough: boolean;
	walkthroughSong: WalkthroughSong | null;
	/** Curated companion songs shown alongside the hero in the song-walkthrough
	 * library. Empty outside the walkthrough. */
	companionSongs?: readonly WalkthroughSong[];
}

const UNSETTLED_POLL_MS = 5_000;

// The song-walkthrough library shows the hero plus a few curated companions.
const WALKTHROUGH_LIBRARY_SIZE = 6;

// Stable empty default so the displayedSongs memo identity doesn't churn.
const NO_COMPANIONS: readonly WalkthroughSong[] = [];

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
	connectionState: ConnectionState,
): number | false {
	if (connectionState === "connected") return false;
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
	accountId,
	filter,
	search,
	isWalkthrough,
	walkthroughSong,
	companionSongs = NO_COMPANIONS,
}: UseLikedSongsCollectionOptions) {
	const { data: connectionState } = useQuery<ConnectionState>({
		queryKey: accountEventsConnectionKey(accountId),
		queryFn: () => "disconnected",
		initialData: "disconnected",
		staleTime: Number.POSITIVE_INFINITY,
	});
	const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
		useInfiniteQuery({
			...likedSongsInfiniteQueryOptions(filter, search),
			// Stream-first: while connected, enrichment terminal events invalidate the
			// liked-songs cache directly from the shell. The old unsettled-row poll is
			// retained only as a disconnected self-heal.
			refetchInterval: (query) =>
				likedSongsCollectionRefetchInterval(query.state.data, connectionState),
		});

	const songs = useMemo(
		() => data?.pages.flatMap((page) => page.songs) ?? [],
		[data?.pages],
	);

	const displayedSongs = useMemo(() => {
		if (!isWalkthrough || !walkthroughSong) return songs;

		// Hero first, then the curated companions, capped at the library size and
		// deduped by id. Prefer a real synced row when one exists (post-sync), else
		// the synthetic analyzed row built from the WalkthroughSong.
		const walkthroughSongs = [walkthroughSong, ...companionSongs];
		const includedIds = new Set<string>();
		const walkthroughRows: LikedSong[] = [];
		for (const ws of walkthroughSongs) {
			if (includedIds.has(ws.id)) continue;
			includedIds.add(ws.id);
			const realSong = songs.find((song) => song.track.id === ws.id);
			const syntheticSong = buildSyntheticLikedSong(ws);
			walkthroughRows.push(
				realSong
					? {
							...realSong,
							displayState: "analyzed",
							analysis: realSong.analysis ?? syntheticSong.analysis,
						}
					: syntheticSong,
			);
			if (walkthroughRows.length >= WALKTHROUGH_LIBRARY_SIZE) break;
		}

		const remainingSongs = songs.filter(
			(song) => !includedIds.has(song.track.id),
		);

		return [...walkthroughRows, ...remainingSongs];
	}, [isWalkthrough, songs, walkthroughSong, companionSongs]);

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
