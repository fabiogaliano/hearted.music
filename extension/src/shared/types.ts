export type SpotifyTokenPayload = {
	accessToken: string;
	expiresAtMs: number;
	isAnonymous: boolean;
};

export type ExtensionMessage =
	| { type: "SPOTIFY_TOKEN"; payload: SpotifyTokenPayload }
	| { type: "GET_STATUS" }
	| { type: "TRIGGER_SYNC" }
	| { type: "GET_TOKEN" };

export type StatusResponse = {
	hasToken: boolean;
	tokenExpiresAtMs: number | null;
};
