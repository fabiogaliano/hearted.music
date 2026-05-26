import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import {
	deletePlaylist,
	getPlaylistById,
	getPlaylistBySpotifyId,
	getPlaylistSongsPage,
	getPlaylists,
	getTargetPlaylists,
	setPlaylistTarget,
	updatePlaylistMetadata,
	upsertPlaylists,
} from "@/lib/domains/library/playlists/queries";
import { getByIds as getSongsByIds } from "@/lib/domains/library/songs/queries";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { PlaylistManagementChanges } from "@/lib/workflows/library-processing/changes/playlist-management";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

const SPOTIFY_PLAYLIST_URI_RE = /^spotify:playlist:([a-zA-Z0-9]+)$/;

function parsePlaylistSpotifyId(uri: string): string | null {
	const match = uri.match(SPOTIFY_PLAYLIST_URI_RE);
	return match ? match[1] : null;
}

const NoInputSchema = z.undefined();

// ============================================================================
// Playlist management reads
// ============================================================================

export const getPlaylistManagementData = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
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

export interface PlaylistTrack {
	position: number;
	songId: string;
	name: string;
	artists: string[];
	albumName: string | null;
	imageUrl: string | null;
}

export interface PlaylistTracksPageResult {
	tracks: PlaylistTrack[];
	nextCursor: number | null;
}

const PLAYLIST_TRACKS_DEFAULT_LIMIT = 50;
const PLAYLIST_TRACKS_MAX_LIMIT = 100;

const PlaylistTracksPageSchema = z.object({
	playlistId: z.string().uuid(),
	cursor: z.number().int().min(0).optional(),
	limit: z.number().int().min(1).max(PLAYLIST_TRACKS_MAX_LIMIT).optional(),
});

export const getPlaylistTracksPage = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => PlaylistTracksPageSchema.parse(data))
	.handler(async ({ data, context }): Promise<PlaylistTracksPageResult> => {
		const { session } = context;
		const limit = data.limit ?? PLAYLIST_TRACKS_DEFAULT_LIMIT;

		const playlistResult = await getPlaylistById(
			session.accountId,
			data.playlistId,
		);
		if (Result.isError(playlistResult)) {
			console.warn("Failed to load playlist", {
				playlistId: data.playlistId,
				error: playlistResult.error,
			});
			throw new Error("Failed to load playlist");
		}
		if (playlistResult.value === null) {
			throw new Error("Playlist not found");
		}
		// Only authorization gate for this read: service-role bypasses RLS, so
		// without this check any session could fetch any account's tracks.
		if (playlistResult.value.account_id !== session.accountId) {
			console.warn("Playlist access denied: account mismatch", {
				playlistId: data.playlistId,
				ownerAccountId: playlistResult.value.account_id,
				sessionAccountId: session.accountId,
			});
			throw new Error("Playlist not found");
		}

		let cursor = data.cursor;

		while (true) {
			const songsResult = await getPlaylistSongsPage(data.playlistId, {
				cursor,
				limit,
			});
			if (Result.isError(songsResult)) {
				console.warn("Failed to load playlist tracks", {
					playlistId: data.playlistId,
					error: songsResult.error,
				});
				throw new Error("Failed to load playlist tracks");
			}

			const { items: playlistSongs, nextCursor } = songsResult.value;
			if (playlistSongs.length === 0) {
				return { tracks: [], nextCursor: null };
			}

			const songIds = playlistSongs.map((ps) => ps.song_id);
			const songsDataResult = await getSongsByIds(songIds);

			if (Result.isError(songsDataResult)) {
				console.warn("Failed to load track details", {
					playlistId: data.playlistId,
					error: songsDataResult.error,
				});
				throw new Error("Failed to load track details");
			}

			const songMap = new Map(songsDataResult.value.map((s) => [s.id, s]));
			const tracks = playlistSongs
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
				.filter((t): t is PlaylistTrack => t !== null);

			if (tracks.length > 0 || nextCursor === null) {
				return { tracks, nextCursor };
			}

			// Skip synthetic empty pages caused by dangling playlist_song rows so the
			// client only sees an empty state when no loadable tracks remain.
			cursor = nextCursor;
		}
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

		const playlistResult = await getPlaylistById(
			session.accountId,
			data.playlistId,
		);
		if (
			Result.isError(playlistResult) ||
			!playlistResult.value ||
			playlistResult.value.account_id !== session.accountId
		) {
			throw new Error("Playlist not found");
		}

		const result = await setPlaylistTarget(
			session.accountId,
			data.playlistId,
			data.isTarget,
		);

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
		const spotifyId = parsePlaylistSpotifyId(data.uri);
		if (!spotifyId) throw new Error(`Invalid Spotify URI: ${data.uri}`);

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
	description: z.string().nullable().optional(),
	songCount: z.number().int().nonnegative().optional(),
	imageUrl: z.string().nullable().optional(),
});

export const acknowledgePlaylistUpdate = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AcknowledgeUpdateSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;
		const metadata: {
			name?: string;
			description?: string | null;
			song_count?: number;
			image_url?: string | null;
		} = {};
		if (data.name !== undefined) metadata.name = data.name;
		if (data.description !== undefined) metadata.description = data.description;
		if (data.songCount !== undefined) metadata.song_count = data.songCount;
		if (data.imageUrl !== undefined) metadata.image_url = data.imageUrl;

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
		const spotifyId = parsePlaylistSpotifyId(data.uri);
		if (!spotifyId) throw new Error(`Invalid Spotify URI: ${data.uri}`);

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

		const deleteResult = await deletePlaylist(
			session.accountId,
			existing.value.id,
		);
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

		const applyResult = await applyLibraryProcessingChange(
			PlaylistManagementChanges.sessionFlushed({
				accountId: session.accountId,
				targetMembershipChanged: data.targetMembershipChanged,
				targetMetadataChanged: data.targetMetadataChanged,
			}),
		);
		if (Result.isError(applyResult)) {
			console.error(
				"[playlists] library-processing apply failed:",
				applyResult.error,
			);
		}

		return { flushed: true };
	});
