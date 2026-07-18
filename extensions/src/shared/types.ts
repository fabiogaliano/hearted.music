// --- Spotify Token & Hash Interception ---

import type { z } from "zod";
import type { SpotifyCommand } from "../../../shared/spotify-command-protocol";
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

export type SpotifyTokenPayload = {
	accessToken: string;
	expiresAtMs: number;
	isAnonymous: boolean;
};

export type PathfinderHashPayload = {
	operationName: string;
	sha256Hash: string;
};

/**
 * The full control-message vocabulary understood by the background dispatcher
 * (see `background/dispatcher.ts`), regardless of which front door it arrived
 * through:
 *   - content scripts / popup → `browser.runtime.onMessage` (SPOTIFY_TOKEN,
 *     PATHFINDER_HASH, ARM_TOKEN_PRESENT, GET_TOKEN, CLOSE_AND_FOCUS_HEARTED,
 *     plus GET_STATUS/TRIGGER_SYNC which the popup and web app both use)
 *   - the web app → `runtime.onMessageExternal` on Chrome, or the app-bridge
 *     envelope on Firefox (PING, CONNECT, TRIGGER_SYNC, SPOTIFY_STATUS,
 *     EXPECT_LOGIN_RETURN, GET_STATUS, SpotifyCommand)
 *   - account visibility (popup primarily, web app allowed): GET_ACCOUNTS,
 *     DISCONNECT_SPOTIFY, DISCONNECT_HEARTED
 * Declared once here so there is exactly one typed vocabulary and one
 * exhaustive dispatcher, instead of two independently-typed message unions
 * routed through two separate handlers.
 */
export type ExtensionWireMessage =
	| { type: "PING" }
	| { type: "CONNECT"; token: string; backendUrl?: string }
	| { type: "TRIGGER_SYNC" }
	| { type: "SPOTIFY_STATUS" }
	| { type: "EXPECT_LOGIN_RETURN"; armToken: string }
	| { type: "GET_STATUS" }
	| { type: "GET_TOKEN" }
	| { type: "CLOSE_AND_FOCUS_HEARTED" }
	| { type: "SPOTIFY_TOKEN"; payload: SpotifyTokenPayload }
	| { type: "PATHFINDER_HASH"; payload: PathfinderHashPayload }
	| { type: "ARM_TOKEN_PRESENT"; token: string }
	| { type: "GET_ACCOUNTS" }
	| { type: "DISCONNECT_SPOTIFY" }
	| { type: "DISCONNECT_HEARTED" }
	| SpotifyCommand;

export type ExtensionWireMessageType = ExtensionWireMessage["type"];

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
