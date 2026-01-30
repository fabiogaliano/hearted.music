/**
 * Server functions for Liked Songs feature.
 *
 * Handles paginated fetching of liked songs with analysis data,
 * and batch album art fetching via Spotify API.
 */

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Result } from "better-result";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { getAll as getAllLikedSongs } from "@/lib/data/liked-song";
import { get as getSongAnalyses } from "@/lib/data/song-analysis";
import { getByIds as getSongsByIds } from "@/lib/data/song";
import type {
	LikedSong,
	LikedSongTrack,
	SongAnalysisData,
	FilterOption,
	AnalysisContent,
} from "@/features/liked-songs/types";

const getLikedSongsPageInputSchema = z.object({
	cursor: z.number().optional(),
	limit: z.number().min(1).max(100).default(50),
	filter: z
		.enum(["all", "unsorted", "sorted", "analyzed"])
		.default("all") as z.ZodType<FilterOption>,
});

export interface LikedSongsPageResult {
	songs: LikedSong[];
	nextCursor: number | null;
	total: number;
}

/**
 * Gets a page of liked songs with their analysis data.
 * Uses cursor-based pagination for efficient loading.
 */
export const getLikedSongsPage = createServerFn({ method: "GET" })
	.inputValidator(getLikedSongsPageInputSchema)
	.handler(
		async ({
			data,
		}: {
			data: { cursor?: number; limit: number; filter: FilterOption };
		}): Promise<LikedSongsPageResult> => {
			const request = getRequest();
			const session = requireSession(request);

			const { cursor = 0, limit, filter } = data;

			const likedSongsResult = await getAllLikedSongs(session.accountId);
			if (Result.isError(likedSongsResult)) {
				throw new Error("Failed to load liked songs");
			}

			let allLikedSongs = likedSongsResult.value.filter(
				(ls) => ls.unliked_at === null,
			);

			const songIds = allLikedSongs.map((ls) => ls.song_id);
			if (songIds.length === 0) {
				return { songs: [], nextCursor: null, total: 0 };
			}

			const [songsResult, analysesResult] = await Promise.all([
				getSongsByIds(songIds),
				getSongAnalyses(songIds),
			]);

			if (Result.isError(songsResult)) {
				throw new Error("Failed to load songs");
			}
			if (Result.isError(analysesResult)) {
				throw new Error("Failed to load analyses");
			}

			const songsMap = new Map(songsResult.value.map((s) => [s.id, s]));
			const analysesMap = analysesResult.value;

			const enrichedSongs: LikedSong[] = allLikedSongs
				.map((ls) => {
					const song = songsMap.get(ls.song_id);
					if (!song) return null;

					const analysis = analysesMap.get(ls.song_id);
					const hasAnalysis = !!analysis;

					const track: LikedSongTrack = {
						id: song.id,
						spotify_id: song.spotify_id,
						name: song.name,
						artist: song.artists?.[0] ?? "Unknown Artist",
						album: song.album_name,
						image_url: song.image_url,
					};

					const analysisData: SongAnalysisData | null = analysis
						? {
								id: analysis.id,
								song_id: analysis.song_id,
								analysis: analysis.analysis as AnalysisContent,
								model: analysis.model,
								created_at: analysis.created_at,
							}
						: null;

					const sortingStatus =
						ls.status === "sorted"
							? ("sorted" as const)
							: ls.status === "ignored"
								? ("ignored" as const)
								: ("unsorted" as const);

					return {
						id: ls.id,
						liked_at: ls.liked_at,
						sorting_status: sortingStatus,
						track,
						analysis: analysisData,
						uiAnalysisStatus: hasAnalysis
							? ("analyzed" as const)
							: ("not_analyzed" as const),
					};
				})
				.filter((s): s is NonNullable<typeof s> => s !== null) as LikedSong[];

			let filteredSongs = enrichedSongs;
			if (filter === "unsorted") {
				filteredSongs = enrichedSongs.filter(
					(s) => s.sorting_status === "unsorted" || s.sorting_status === null,
				);
			} else if (filter === "sorted") {
				filteredSongs = enrichedSongs.filter(
					(s) => s.sorting_status === "sorted",
				);
			} else if (filter === "analyzed") {
				filteredSongs = enrichedSongs.filter(
					(s) => s.uiAnalysisStatus === "analyzed",
				);
			}

			const total = filteredSongs.length;
			const paginatedSongs = filteredSongs.slice(cursor, cursor + limit);
			const nextCursor = cursor + limit < total ? cursor + limit : null;

			return {
				songs: paginatedSongs,
				nextCursor,
				total,
			};
		},
	);

const getTrackImagesInputSchema = z.object({
	ids: z.array(z.string()).min(1).max(50),
});

/**
 * Batch fetches album art URLs for tracks.
 * Spotify API limit is 50 tracks per request.
 */
export const getTrackImages = createServerFn({ method: "GET" })
	.inputValidator(getTrackImagesInputSchema)
	.handler(
		async ({
			data,
		}: {
			data: { ids: string[] };
		}): Promise<{ images: Record<string, string> }> => {
			const request = getRequest();
			requireSession(request);

			const songsResult = await getSongsByIds(data.ids);
			if (Result.isError(songsResult)) {
				return { images: {} };
			}

			const images: Record<string, string> = {};
			for (const song of songsResult.value) {
				if (song.image_url) {
					images[song.spotify_id] = song.image_url;
				}
			}

			return { images };
		},
	);
