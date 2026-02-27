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
	track_count: number;
	image_url: string | null;
};
