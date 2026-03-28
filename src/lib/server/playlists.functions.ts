import { Result } from "better-result";
import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import {
	upsertPlaylists,
	getPlaylistBySpotifyId,
	deletePlaylist,
	updatePlaylistMetadata,
} from "@/lib/domains/library/playlists/queries";

const SPOTIFY_PLAYLIST_URI_RE = /^spotify:playlist:([a-zA-Z0-9]+)$/;

function parsePlaylistSpotifyId(uri: string): string | null {
	const match = uri.match(SPOTIFY_PLAYLIST_URI_RE);
	return match ? match[1] : null;
}

// ============================================================================
// Create acknowledgement
// ============================================================================

const AcknowledgeCreateSchema = z.object({
	uri: z.string().regex(SPOTIFY_PLAYLIST_URI_RE),
	name: z.string().min(1),
});

export const acknowledgePlaylistCreate = createServerFn({ method: "POST" })
	.inputValidator((data) => AcknowledgeCreateSchema.parse(data))
	.handler(async ({ data }) => {
		const { session } = await requireAuthSession();
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
	.inputValidator((data) => AcknowledgeUpdateSchema.parse(data))
	.handler(async ({ data }) => {
		const { session } = await requireAuthSession();
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
	.inputValidator((data) => AcknowledgeDeleteSchema.parse(data))
	.handler(async ({ data }) => {
		const { session } = await requireAuthSession();
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
