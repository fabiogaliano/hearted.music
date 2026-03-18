import { Result } from "better-result";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import * as likedSong from "@/lib/domains/library/liked-songs/queries";
import type { LikedSongPageRow } from "@/lib/domains/library/liked-songs/queries";
import {
	insertMatchDecision,
	insertMatchDecisions,
} from "@/lib/data/match-decision-queries";
import { appFetch } from "@/lib/integrations/spotify/app-auth";
import type { FilterOption } from "@/features/liked-songs/queries";
import type {
	LikedSong,
	MatchingStatus,
	AnalysisContent,
} from "@/features/liked-songs/types";

const LikedSongsPageSchema = z.object({
	filter: z.enum(["all", "pending", "matched", "analyzed"]),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional(),
});

const ArtistImageByIdSchema = z.object({
	artistId: z.string().min(1),
});

const AddToPlaylistSchema = z.object({
	songId: z.uuid(),
	playlistId: z.uuid(),
	spotifyTrackId: z.string().min(1),
	spotifyPlaylistId: z.string().min(1),
});

export interface LikedSongsPageParams {
	filter: FilterOption;
	cursor?: string;
	limit?: number;
}

export interface LikedSongsPageResult {
	songs: LikedSong[];
	nextCursor: string | null;
}

export const getLikedSongsPage = createServerFn({ method: "GET" })
	.inputValidator((data) => LikedSongsPageSchema.parse(data))
	.handler(async ({ data }): Promise<LikedSongsPageResult> => {
		const { session } = await requireAuthSession();

		const limit = data.limit ?? 15;

		const result = await likedSong.getPageWithDetails(session.accountId, {
			cursor: data.cursor,
			limit,
			filter: data.filter,
		});

		if (Result.isError(result)) {
			return { songs: [], nextCursor: null };
		}

		const { items, nextCursor } = result.value;

		const songs: LikedSong[] = items.map((row: LikedSongPageRow) => ({
			liked_at: row.liked_at,
			matching_status: (row.matching_status as MatchingStatus) ?? null,
			track: {
				id: row.song_id,
				spotify_track_id: row.song_spotify_id,
				name: row.song_name,
				artist: row.song_artists[0] ?? "Unknown Artist",
				artist_id: row.song_artist_ids?.[0] ?? null,
				album: row.song_album_name,
				image_url: row.song_image_url,
				genres: row.song_genres ?? [],
				audio_features:
					row.audio_tempo != null ||
					row.audio_energy != null ||
					row.audio_valence != null
						? {
								tempo: row.audio_tempo,
								energy: row.audio_energy,
								valence: row.audio_valence,
							}
						: null,
			},
			analysis: row.analysis_id
				? {
						id: row.analysis_id,
						track_id: row.song_id,
						analysis: row.analysis_content as AnalysisContent,
						model_name: row.analysis_model ?? "unknown",
						version: 1,
						created_at: row.analysis_created_at,
					}
				: null,
			uiAnalysisStatus: row.analysis_id ? "analyzed" : "not_analyzed",
		}));

		return { songs, nextCursor };
	});

export type LikedSongsStatsResult =
	| {
			success: true;
			total: number;
			analyzed: number;
			matched: number;
			has_suggestions: number;
			pending: number;
	  }
	| { success: false; error: string };

export const getLikedSongsStats = createServerFn({ method: "GET" }).handler(
	async (): Promise<LikedSongsStatsResult> => {
		const { session } = await requireAuthSession();

		const result = await likedSong.getStats(session.accountId);

		if (Result.isError(result)) {
			return { success: false, error: "Failed to fetch stats" };
		}

		const row = result.value;
		return {
			success: true,
			total: Number(row.total),
			analyzed: Number(row.analyzed),
			matched: Number(row.matched),
			has_suggestions: Number(row.has_suggestions),
			pending: Number(row.pending),
		};
	},
);

export interface ArtistImageResult {
	url: string | null;
}

const ArtistsSchema = z.object({
	artists: z.array(
		z
			.object({
				images: z.array(z.object({ url: z.string() })),
			})
			.nullable(),
	),
});

export interface ArtistImageByIdParams {
	artistId: string;
}

export const getArtistImageById = createServerFn({ method: "GET" })
	.inputValidator((data) => ArtistImageByIdSchema.parse(data))
	.handler(async ({ data }): Promise<ArtistImageResult> => {
		await requireAuthSession();

		const artistsResult = await appFetch(
			`/artists?ids=${data.artistId}`,
			ArtistsSchema,
		);
		if (Result.isError(artistsResult)) return { url: null };

		return { url: artistsResult.value.artists[0]?.images[0]?.url ?? null };
	});

export interface AddToPlaylistParams {
	songId: string;
	playlistId: string;
	spotifyTrackId: string;
	spotifyPlaylistId: string;
}

export interface AddToPlaylistResult {
	success: boolean;
}

export const addSongToPlaylist = createServerFn({ method: "POST" })
	.inputValidator((data) => AddToPlaylistSchema.parse(data))
	.handler(async ({ data }): Promise<AddToPlaylistResult> => {
		const { session } = await requireAuthSession();
		const result = await insertMatchDecision(
			session.accountId,
			data.songId,
			data.playlistId,
			"added",
		);
		return { success: Result.isOk(result) };
	});

const DismissSongSchema = z.object({
	songId: z.uuid(),
	playlistIds: z.array(z.uuid()).min(1),
});

export interface DismissSongParams {
	songId: string;
	playlistIds: string[];
}

export const dismissSong = createServerFn({ method: "POST" })
	.inputValidator((data) => DismissSongSchema.parse(data))
	.handler(async ({ data }) => {
		const { session } = await requireAuthSession();
		const decisions = data.playlistIds.map((playlistId) => ({
			accountId: session.accountId,
			songId: data.songId,
			playlistId,
			decision: "dismissed" as const,
		}));
		const result = await insertMatchDecisions(decisions);
		return { success: Result.isOk(result) };
	});
