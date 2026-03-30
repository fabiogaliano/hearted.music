import { Result } from "better-result";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import {
	upsertPlaylists,
	getPlaylists,
	getTargetPlaylists,
	getPlaylistById,
	getPlaylistBySpotifyId,
	getPlaylistSongs,
	deletePlaylist,
	setPlaylistTarget,
	updatePlaylistMetadata,
} from "@/lib/domains/library/playlists/queries";
import { getByIds as getSongsByIds } from "@/lib/domains/library/songs/queries";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

const SPOTIFY_PLAYLIST_URI_RE = /^spotify:playlist:([a-zA-Z0-9]+)$/;

function parsePlaylistSpotifyId(uri: string): string | null {
	const match = uri.match(SPOTIFY_PLAYLIST_URI_RE);
	return match ? match[1] : null;
}

// ============================================================================
// Playlist management reads
// ============================================================================

export const getPlaylistManagementData = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }) => {
		const { session } = context;

		const [allResult, targetResult] = await Promise.all([
			getPlaylists(session.accountId),
			getTargetPlaylists(session.accountId),
		]);

		if (Result.isError(allResult)) {
			throw new Error(`Failed to load playlists: ${allResult.error.message}`);
		}

		const targetIds = new Set(
			Result.isOk(targetResult) ? targetResult.value.map((p) => p.id) : [],
		);

		return {
			playlists: allResult.value,
			targetPlaylistIds: [...targetIds],
		};
	});

export interface PlaylistTrackPreview {
	position: number;
	songId: string;
	name: string;
	artists: string[];
	albumName: string | null;
	imageUrl: string | null;
}

const PlaylistTracksSchema = z.object({
	playlistId: z.string().uuid(),
});

export const getPlaylistTrackPreview = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => PlaylistTracksSchema.parse(data))
	.handler(async ({ data, context }): Promise<PlaylistTrackPreview[]> => {
		const { session } = context;

		const playlistResult = await getPlaylistById(data.playlistId);
		if (
			Result.isError(playlistResult) ||
			!playlistResult.value ||
			playlistResult.value.account_id !== session.accountId
		) {
			return [];
		}

		const songsResult = await getPlaylistSongs(data.playlistId);
		if (Result.isError(songsResult) || songsResult.value.length === 0) {
			return [];
		}

		const playlistSongs = songsResult.value;
		const songIds = playlistSongs.map((ps) => ps.song_id);
		const songsDataResult = await getSongsByIds(songIds);

		if (Result.isError(songsDataResult)) {
			return [];
		}

		const songMap = new Map(songsDataResult.value.map((s) => [s.id, s]));

		return playlistSongs
			.map((ps) => {
				const song = songMap.get(ps.song_id);
				if (!song) return null;
				return {
					position: ps.position,
					songId: song.id,
					name: song.name,
					artists: song.artists ?? [],
					albumName: song.album_name,
					imageUrl: song.image_url,
				};
			})
			.filter((t): t is PlaylistTrackPreview => t !== null);
	});

// ============================================================================
// Target membership mutations
// ============================================================================

const SetTargetSchema = z.object({
	playlistId: z.string().uuid(),
	isTarget: z.boolean(),
});

export const setPlaylistTargetMutation = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => SetTargetSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;

		const playlistResult = await getPlaylistById(data.playlistId);
		if (
			Result.isError(playlistResult) ||
			!playlistResult.value ||
			playlistResult.value.account_id !== session.accountId
		) {
			throw new Error("Playlist not found");
		}

		const result = await setPlaylistTarget(data.playlistId, data.isTarget);

		if (Result.isError(result)) {
			throw new Error(`Failed to set playlist target: ${result.error.message}`);
		}

		return { success: true, playlist: result.value };
	});

// ============================================================================
// Create acknowledgement
// ============================================================================

const AcknowledgeCreateSchema = z.object({
	uri: z.string().regex(SPOTIFY_PLAYLIST_URI_RE),
	name: z.string().min(1),
});

export const acknowledgePlaylistCreate = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AcknowledgeCreateSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;
		const spotifyId = parsePlaylistSpotifyId(data.uri)!;

		const result = await upsertPlaylists(session.accountId, [
			{
				spotify_id: spotifyId,
				name: data.name,
				description: null,
				snapshot_id: null,
				is_public: true,
				song_count: 0,
				is_target: false,
				image_url: null,
			},
		]);

		if (Result.isError(result)) {
			throw new Error(
				`Failed to acknowledge playlist create: ${result.error.message}`,
			);
		}

		return { success: true, spotifyId };
	});

// ============================================================================
// Metadata update acknowledgement
// ============================================================================

const AcknowledgeUpdateSchema = z.object({
	spotifyId: z.string().min(1),
	name: z.string().min(1).optional(),
	description: z.string().optional(),
});

export const acknowledgePlaylistUpdate = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AcknowledgeUpdateSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;
		const metadata: { name?: string; description?: string } = {};
		if (data.name !== undefined) metadata.name = data.name;
		if (data.description !== undefined) metadata.description = data.description;

		const result = await updatePlaylistMetadata(
			session.accountId,
			data.spotifyId,
			metadata,
		);

		if (Result.isError(result)) {
			throw new Error(
				`Failed to acknowledge playlist update: ${result.error.message}`,
			);
		}

		return { success: true };
	});

// ============================================================================
// Delete acknowledgement
// ============================================================================

const AcknowledgeDeleteSchema = z.object({
	uri: z.string().regex(SPOTIFY_PLAYLIST_URI_RE),
});

export const acknowledgePlaylistDelete = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AcknowledgeDeleteSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;
		const spotifyId = parsePlaylistSpotifyId(data.uri)!;

		const existing = await getPlaylistBySpotifyId(session.accountId, spotifyId);
		if (Result.isError(existing)) {
			throw new Error(
				`Failed to look up playlist for delete: ${existing.error.message}`,
			);
		}

		// Idempotent: if already absent, treat as success
		if (existing.value === null) {
			return { success: true, alreadyAbsent: true };
		}

		const deleteResult = await deletePlaylist(existing.value.id);
		if (Result.isError(deleteResult)) {
			throw new Error(
				`Failed to acknowledge playlist delete: ${deleteResult.error.message}`,
			);
		}

		return { success: true, alreadyAbsent: false };
	});

// ============================================================================
// Playlist management session flush
// ============================================================================

const FlushSessionSchema = z.object({
	targetMembershipChanged: z.boolean(),
	targetMetadataChanged: z.boolean(),
});

export const flushPlaylistManagementSession = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.inputValidator((data) => FlushSessionSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;

		if (!data.targetMembershipChanged && !data.targetMetadataChanged) {
			return { flushed: false };
		}

		await applyLibraryProcessingChange({
			kind: "playlist_management_session_flushed",
			accountId: session.accountId,
			targetMembershipChanged: data.targetMembershipChanged,
			targetMetadataChanged: data.targetMetadataChanged,
		});

		return { flushed: true };
	});
