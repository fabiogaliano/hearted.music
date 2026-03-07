// --- Spotify Token & Hash Interception ---

import type { SpotifyCommand } from "../../../shared/spotify-command-protocol";
export type {
	AddToPlaylistPayload,
	CommandResponse,
	CommandResponseError,
	CommandResponseOk,
	CreatePlaylistPayload,
	DeletePlaylistPayload,
	QueryArtistOverviewPayload,
	RemoveFromPlaylistPayload,
	SpotifyCommand,
	SpotifyCommandMap,
	SpotifyCommandName,
	SpotifyErrorCode,
	UpdatePlaylistPayload,
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

export type ExtensionMessage =
	| { type: "SPOTIFY_TOKEN"; payload: SpotifyTokenPayload }
	| { type: "PATHFINDER_HASH"; payload: PathfinderHashPayload }
	| { type: "GET_STATUS" }
	| { type: "TRIGGER_SYNC" }
	| { type: "GET_TOKEN" };

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

/** Mirrors backend SpotifyTrackDTO — extension cannot import from app source */
export type SpotifyTrackDTO = {
	added_at: string;
	track: {
		id: string;
		name: string;
		artists: Array<{ id: string; name: string }>;
		album: {
			id: string;
			name: string;
			images: Array<{ url: string; width: number; height: number }>;
		};
		duration_ms: number;
		uri: string;
	};
};

/** Mirrors backend SpotifyPlaylistDTO (superset with optional owner enrichment) */
export type SpotifyPlaylistDTO = {
	id: string;
	name: string;
	description: string | null;
	owner: { id: string; name?: string; image_url?: string };
	track_count: number | null;
	image_url: string | null;
};

/** All messages received via chrome.runtime.onMessageExternal (from web app) */
export type ExternalMessage =
	| { type: "PING" }
	| { type: "CONNECT"; token: string; backendUrl?: string }
	| { type: "TRIGGER_SYNC" }
	| { type: "SPOTIFY_STATUS" }
	| SpotifyCommand;
