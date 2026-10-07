import type { SpotifyCommand } from "./spotify-command-protocol";

// The web app (src/lib/extension/transport.ts) and the extension's background
// dispatcher both speak this vocabulary, so it lives here rather than inside
// either app.

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
 * (see `extensions/src/background/dispatcher.ts`), regardless of which front door it arrived
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
