// --- Spotify Token & Hash Interception ---

import type { z } from "zod";
// Type-only import: erased at build time, so zod itself is never bundled into
// the extension. `z.infer` gives these DTOs a compiler-checked link to the
// same schema the Bun worker validates the sync upload against, instead of a
// hand-duplicated shape that can silently drift (see
// shared/spotify-sync-payload-schema.ts).
import type {
	SpotifyPlaylistDTOSchema,
	SpotifyTrackArtistDTOSchema,
	SpotifyTrackDTOSchema,
} from "../../../shared/spotify-sync-payload-schema";

export type {
	AddToPlaylistPayload,
	CommandResponse,
	CommandResponseError,
	CommandResponseOk,
	CreatePlaylistPayload,
	DeletePlaylistPayload,
	FetchPlaylistMetadataPayload,
	MoveInPlaylistPayload,
	QueryArtistOverviewPayload,
	RegisterPlaylistPayload,
	RemoveFromPlaylistPayload,
	RemovePlaylistCoverPayload,
	SetPlaylistVisibilityPayload,
	SpotifyCommand,
	SpotifyCommandMap,
	SpotifyCommandName,
	SpotifyErrorCode,
	UpdatePlaylistPayload,
	UploadPlaylistCoverPayload,
} from "../../../shared/spotify-command-protocol";

export type StatusResponse = {
	hasToken: boolean;
	tokenExpiresAtMs: number | null;
};

/** User profile extracted from Spotify's profileAttributes pathfinder query */
export type UserProfile = {
	spotifyId: string;
	displayName: string;
	username: string;
	avatarUrl: string | null;
};

/** Identity of the hearted account the stored apiToken acts as, as reported by
 * GET /api/extension/status. All-null when the backend was unreachable and no
 * cached identity exists. */
export type HeartedIdentity = {
	displayName: string | null;
	imageUrl: string | null;
	spotifyId: string | null;
};

/**
 * Pairing status for the hearted side of the extension.
 *  - disconnected: no apiToken stored (never paired, or explicitly forgotten)
 *  - revoked: backend rejected the stored apiToken (401) — re-pair from the app
 *  - connected: apiToken present; `verified` is false when the backend could
 *    not be reached, in which case `account` comes from the last cached check
 */
export type HeartedAccountStatus =
	| { state: "disconnected" }
	| { state: "revoked" }
	| { state: "connected"; account: HeartedIdentity; verified: boolean };

/** Response payload for GET_ACCOUNTS. */
export type AccountsResponse = {
	type: "ACCOUNTS";
	spotify: UserProfile | null;
	hearted: HeartedAccountStatus;
};

/** Derived from the shared sync payload schema — see import comment above. */
export type SpotifyTrackArtistDTO = z.infer<typeof SpotifyTrackArtistDTOSchema>;

/** Derived from the shared sync payload schema, which the Bun worker validates
 * the sync upload against — a compiler-checked link instead of a
 * hand-duplicated shape that can silently drift. */
export type SpotifyTrackDTO = z.infer<typeof SpotifyTrackDTOSchema>;

/** Derived from the shared sync payload schema (see SpotifyTrackDTO above). */
export type SpotifyPlaylistDTO = z.infer<typeof SpotifyPlaylistDTOSchema>;
