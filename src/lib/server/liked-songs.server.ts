import { Result } from "better-result";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSession } from "@/lib/auth/session";
import * as likedSong from "@/lib/data/liked-song";
import type { LikedSongPageRow } from "@/lib/data/liked-song";
import { getSpotifyClient } from "@/lib/integrations/spotify/client";
import { appFetch } from "@/lib/integrations/spotify/app-auth";
import type { FilterOption } from "@/features/liked-songs/queries";
import type {
	LikedSong,
	MatchingStatus,
	AnalysisContent,
} from "@/features/liked-songs/types";

// ─── Input Validation Schemas ───────────────────────────────────────────────

const LikedSongsPageSchema = z.object({
	filter: z.enum(["all", "pending", "matched", "analyzed"]),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).optional(),
});

const ArtistImageSchema = z.object({
	trackId: z.string().min(1),
});

const ArtistImageByIdSchema = z.object({
	artistId: z.string().min(1),
});

const AddToPlaylistSchema = z.object({
	songId: z.uuid(),
	spotifyTrackId: z.string().min(1),
	spotifyPlaylistId: z.string().min(1),
});

// ─── Types ──────────────────────────────────────────────────────────────────

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
		const request = getRequest();
		const session = requireSession(request);

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
			pending: number;
	  }
	| { success: false; error: string };

export const getLikedSongsStats = createServerFn({ method: "GET" }).handler(
	async (): Promise<LikedSongsStatsResult> => {
		const request = getRequest();
		const session = requireSession(request);

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
			pending: Number(row.pending),
		};
	},
);

export interface ArtistImageParams {
	trackId: string;
}

export interface ArtistImageResult {
	url: string | null;
}

const TracksSchema = z.object({
	tracks: z.array(
		z
			.object({
				artists: z.array(z.object({ id: z.string() })),
			})
			.nullable(),
	),
});

const ArtistsSchema = z.object({
	artists: z.array(
		z
			.object({
				images: z.array(z.object({ url: z.string() })),
			})
			.nullable(),
	),
});

export const getArtistImageForTrack = createServerFn({ method: "GET" })
	.inputValidator((data) => ArtistImageSchema.parse(data))
	.handler(async ({ data }): Promise<ArtistImageResult> => {
		const request = getRequest();
		requireSession(request);

		const tracksResult = await appFetch(
			`/tracks?ids=${data.trackId}`,
			TracksSchema,
		);
		if (Result.isError(tracksResult)) return { url: null };

		const artistId = tracksResult.value.tracks[0]?.artists[0]?.id;
		if (!artistId) return { url: null };

		const artistsResult = await appFetch(
			`/artists?ids=${artistId}`,
			ArtistsSchema,
		);
		if (Result.isError(artistsResult)) return { url: null };

		return { url: artistsResult.value.artists[0]?.images[0]?.url ?? null };
	});

export interface ArtistImageByIdParams {
	artistId: string;
}

export const getArtistImageById = createServerFn({ method: "GET" })
	.inputValidator((data) => ArtistImageByIdSchema.parse(data))
	.handler(async ({ data }): Promise<ArtistImageResult> => {
		const request = getRequest();
		requireSession(request);

		const artistsResult = await appFetch(
			`/artists?ids=${data.artistId}`,
			ArtistsSchema,
		);
		if (Result.isError(artistsResult)) return { url: null };

		return { url: artistsResult.value.artists[0]?.images[0]?.url ?? null };
	});

export interface AddToPlaylistParams {
	songId: string;
	spotifyTrackId: string;
	spotifyPlaylistId: string;
}

export interface AddToPlaylistResult {
	success: boolean;
}

export const addSongToPlaylist = createServerFn({ method: "POST" })
	.inputValidator((data) => AddToPlaylistSchema.parse(data))
	.handler(async ({ data }): Promise<AddToPlaylistResult> => {
		const request = getRequest();
		const session = requireSession(request);

		const clientResult = await getSpotifyClient(session.accountId);
		if (Result.isError(clientResult)) return { success: false };

		const trackUri = `spotify:track:${data.spotifyTrackId}`;

		try {
			const response = await clientResult.value.fetch(
				`/playlists/${data.spotifyPlaylistId}/tracks`,
				{
					method: "POST",
					body: JSON.stringify({ uris: [trackUri], position: 0 }),
				},
			);

			if (!response.ok) return { success: false };

			await likedSong.updateStatus(
				session.accountId,
				data.songId,
				"added_to_playlist",
			);

			return { success: true };
		} catch {
			return { success: false };
		}
	});
