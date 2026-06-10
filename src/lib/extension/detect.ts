/**
 * Extension detection + command helpers.
 *
 * The transport is abstracted behind transport.ts — Chrome talks over
 * externally_connectable, Firefox over the app-bridge postMessage channel.
 * These helpers only shape the request and interpret the response, so they are
 * transport-agnostic and their public signatures are unchanged across browsers.
 */

import type {
	ExtensionSyncBackendFailure,
	ExtensionSyncBackendFailureCode,
	ExtensionSyncRequestResult,
} from "../../../shared/extension-sync-contract";
import { sendExtensionCommand } from "./transport";

type ExtensionSyncCounter = {
	fetched: number;
	total: number;
};

export type ExtensionSyncState = {
	status: "idle" | "syncing" | "done" | "error";
	phase:
		| "idle"
		| "likedSongs"
		| "playlists"
		| "playlistTracks"
		| "artistImages"
		| "uploading";
	fetched: number;
	total: number;
	likedSongs: ExtensionSyncCounter;
	playlists: ExtensionSyncCounter;
	playlistTracks: ExtensionSyncCounter;
	artistImages: ExtensionSyncCounter;
	lastSyncAt: number | null;
	error: string | null;
};

export type ExtensionStatusResponse = {
	hasToken: boolean;
	tokenExpiresAtMs: number | null;
	sync: ExtensionSyncState;
};

export type { ExtensionSyncBackendFailure, ExtensionSyncBackendFailureCode };

// Re-exported so existing callers (e.g. spotify-client.ts) keep importing it
// from here; the implementation now lives in transport.ts.
export { sendExtensionCommand };

export async function getSpotifyConnectionStatus(): Promise<boolean> {
	const response = await sendExtensionCommand<{
		type?: string;
		hasToken?: boolean;
	}>({ type: "SPOTIFY_STATUS" });
	return response?.type === "SPOTIFY_STATUS" && response.hasToken === true;
}

export async function getExtensionStatus(): Promise<ExtensionStatusResponse | null> {
	return sendExtensionCommand<ExtensionStatusResponse>({ type: "GET_STATUS" });
}

export async function expectLoginReturn(armToken: string): Promise<boolean> {
	const response = await sendExtensionCommand<{ ok?: boolean }>({
		type: "EXPECT_LOGIN_RETURN",
		armToken,
	});
	return response?.ok === true;
}

export async function connectExtension(
	token: string,
	backendUrl: string,
): Promise<boolean> {
	const response = await sendExtensionCommand<{ type?: string }>({
		type: "CONNECT",
		token,
		backendUrl,
	});
	return response?.type === "CONNECTED";
}

export function triggerExtensionSync(): void {
	// Fire-and-forget — onboarding's retry loop doesn't await the outcome.
	void sendExtensionCommand({ type: "TRIGGER_SYNC" });
}

/** Awaited outcome of a TRIGGER_SYNC command (mirrors the service worker reply). */
export type { ExtensionSyncRequestResult };

/**
 * Awaited TRIGGER_SYNC. Unlike `triggerExtensionSync` (fire-and-forget, right
 * for onboarding's retry loop), the dashboard needs the command's outcome to
 * drive its CTA state. Returns `null` only when the extension is unreachable —
 * a reachable extension always resolves to an `ok`/`error` envelope.
 */
export async function requestExtensionSync(): Promise<ExtensionSyncRequestResult | null> {
	return sendExtensionCommand<ExtensionSyncRequestResult>({
		type: "TRIGGER_SYNC",
	});
}

export async function isExtensionInstalled(): Promise<boolean> {
	const response = await sendExtensionCommand<{ type?: string }>({
		type: "PING",
	});
	return response?.type === "PONG";
}
