import { parseSpotifyCommand } from "../../../shared/spotify-command-protocol";
import { DEFAULT_BACKEND_URL } from "../shared/constants";
import { updateHash } from "../shared/hash-registry";
import {
	fetchAllLikedTracks,
	fetchPlaylistTracks,
	getCurrentUserProfile as fetchProfile,
	fetchUserPlaylists,
} from "../shared/spotify-client/reads";
import { getSyncState, setSyncState } from "../shared/storage";
import type {
	ExtensionMessage,
	SpotifyTokenPayload,
	StatusResponse,
	UserProfile,
} from "../shared/types";
import { handleSpotifyCommand } from "./command-handler";

let cachedToken: SpotifyTokenPayload | null = null;
let cachedProfile: UserProfile | null = null;
let isSyncing = false;

const SPOTIFY_COOKIE_URL = "https://open.spotify.com/";

function normalizeBackendUrl(url: string): string {
	return url.endsWith("/") ? url.slice(0, -1) : url;
}

function isValidBackendUrl(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0) return false;
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

async function getBackendUrl(): Promise<string> {
	const { backendUrl } = await chrome.storage.local.get("backendUrl");
	if (isValidBackendUrl(backendUrl)) {
		return normalizeBackendUrl(backendUrl);
	}
	return DEFAULT_BACKEND_URL;
}

function clearSpotifyTokenCache(): void {
	cachedToken = null;
	cachedProfile = null;
	chrome.storage.local.remove("spotifyToken");
}

async function hasSpotifySession(): Promise<boolean> {
	try {
		const cookie = await chrome.cookies.get({
			url: SPOTIFY_COOKIE_URL,
			name: "sp_dc",
		});
		return Boolean(cookie?.value);
	} catch {
		return false;
	}
}

function isTokenValid(): boolean {
	return cachedToken !== null && Date.now() < cachedToken.expiresAtMs;
}

async function getApiToken(): Promise<string> {
	const { apiToken } = await chrome.storage.local.get("apiToken");
	if (!apiToken) {
		throw new Error("No API token - extension not connected");
	}
	return apiToken;
}

async function postToBackend(
	path: string,
	body: Record<string, unknown>,
): Promise<Response> {
	const apiToken = await getApiToken();
	const backendUrl = await getBackendUrl();
	return fetch(new URL(path, `${backendUrl}/`).toString(), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiToken}`,
		},
		body: JSON.stringify(body),
	});
}

type SyncResult = {
	count: number;
	backendResult?: unknown;
	backendError?: string;
};

async function performSync(): Promise<SyncResult> {
	if (!isTokenValid()) throw new Error("No valid token");
	if (isSyncing) {
		console.log("[hearted.] Sync already in progress, skipping");
		return { count: 0 };
	}
	isSyncing = true;
	const token = (cachedToken as SpotifyTokenPayload).accessToken;
	await setSyncState({ status: "syncing", fetched: 0, total: 0, error: null });
	try {
		if (!cachedProfile) {
			cachedProfile = await fetchProfile(token);
			console.log(`[hearted.] Current user: ${cachedProfile.displayName}`);
		}

		const likedSongs = await fetchAllLikedTracks(
			token,
			async (fetched, total) => {
				await setSyncState({ fetched, total });
			},
		);

		const userUri = `spotify:user:${cachedProfile.spotifyId}`;
		const playlists = await fetchUserPlaylists(token, userUri);
		const userProfile = cachedProfile;

		console.log(
			`[hearted.] Sync complete: ${likedSongs.length} liked songs, ${playlists.length} playlists`,
		);

		try {
			const res = await postToBackend("/api/extension/sync", {
				likedSongs,
				playlists,
				userProfile,
			});
			if (res.ok) {
				const result = await res.json();
				await setSyncState({
					status: "done",
					fetched: likedSongs.length,
					total: likedSongs.length,
					lastSyncAt: Date.now(),
				});
				console.log("[hearted.] Backend sync result:", result);
				return { count: likedSongs.length, backendResult: result };
			} else {
				await setSyncState({
					status: "error",
					error: `Backend HTTP ${res.status}`,
				});
				console.warn(`[hearted.] Backend sync failed: ${res.status}`);
				return { count: likedSongs.length, backendError: `HTTP ${res.status}` };
			}
		} catch {
			await setSyncState({ status: "error", error: "Backend unreachable" });
			console.warn("[hearted.] Backend unreachable");
			return { count: likedSongs.length, backendError: "unreachable" };
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : "Unknown error";
		await setSyncState({ status: "error", error });
		console.error("[hearted.] Sync failed:", error);
		throw err;
	} finally {
		isSyncing = false;
	}
}

// Debug helpers (callable from SW console)
type DebugSelf = {
	testFetch: () => Promise<unknown>;
	triggerSync: () => Promise<unknown>;
	fetchPlaylists: () => Promise<unknown>;
	getProfile: () => Promise<unknown>;
	fetchPlaylistTracks: (playlistUri: string) => Promise<unknown>;
};
const dbg = self as unknown as DebugSelf;

dbg.testFetch = async () => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	const token = (cachedToken as SpotifyTokenPayload).accessToken;
	const tracks = await fetchAllLikedTracks(token);
	const sample = tracks.slice(0, 5);
	console.log("[hearted.] Sample tracks:", sample);
	return sample;
};

dbg.triggerSync = async () => {
	try {
		const result = await performSync();
		console.log(`[hearted.] triggerSync result:`, result);
		return result;
	} catch (err) {
		console.error("[hearted.] triggerSync error:", err);
	}
};

dbg.fetchPlaylists = async () => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	const token = (cachedToken as SpotifyTokenPayload).accessToken;
	if (!cachedProfile) {
		cachedProfile = await fetchProfile(token);
	}
	const userUri = `spotify:user:${cachedProfile.spotifyId}`;
	const playlists = await fetchUserPlaylists(token, userUri);
	console.log("[hearted.] Playlists:", playlists);
	return playlists;
};

dbg.getProfile = async () => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	const token = (cachedToken as SpotifyTokenPayload).accessToken;
	const profile = await fetchProfile(token);
	cachedProfile = profile;
	console.log("[hearted.] Profile:", profile);
	return profile;
};

dbg.fetchPlaylistTracks = async (playlistUri: string) => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	const token = (cachedToken as SpotifyTokenPayload).accessToken;
	const tracks = await fetchPlaylistTracks(token, playlistUri);
	console.log("[hearted.] Playlist tracks:", tracks);
	return tracks;
};

const tokenProvider = {
	getCachedToken: () => cachedToken,
	setCachedToken: (token: SpotifyTokenPayload) => {
		cachedToken = token;
	},
	isTokenValid,
};

chrome.runtime.onInstalled.addListener(async (details) => {
	console.log("[hearted.] Extension installed:", details.reason);

	// Re-inject content scripts into existing Spotify tabs so token
	// interception resumes without requiring a manual page refresh.
	try {
		const tabs = await chrome.tabs.query({ url: "https://open.spotify.com/*" });
		for (const tab of tabs) {
			if (!tab.id) continue;
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: ["content/intercept-token.js"],
				world: "MAIN",
			});
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: ["content/spotify-token.js"],
			});
			console.log("[hearted.] Re-injected content scripts into tab", tab.id);
		}
	} catch (err) {
		console.warn("[hearted.] Failed to re-inject content scripts:", err);
	}
});

chrome.runtime.onMessageExternal.addListener(
	(message, _sender, sendResponse) => {
		if (message.type === "PING") {
			sendResponse({ type: "PONG" });
			return true;
		}

		if (message.type === "CONNECT") {
			(async () => {
				const storagePayload: Record<string, string> = {
					apiToken: message.token,
				};
				if (isValidBackendUrl(message.backendUrl)) {
					storagePayload.backendUrl = normalizeBackendUrl(message.backendUrl);
				}
				await new Promise<void>((resolve) =>
					chrome.storage.local.set(storagePayload, resolve),
				);
				console.log(
					`[hearted.] Connected with API token from web app (${storagePayload.backendUrl ?? DEFAULT_BACKEND_URL})`,
				);

				// Re-hydrate Spotify token if SW was restarted
				if (!cachedToken) {
					const { spotifyToken } =
						await chrome.storage.local.get("spotifyToken");
					if (spotifyToken) cachedToken = spotifyToken as SpotifyTokenPayload;
				}

				sendResponse({ type: "CONNECTED" });

				// Auto-sync if Spotify token is already available (user has Spotify open)
				if (isTokenValid()) {
					performSync().catch((err) =>
						console.error("[hearted.] Auto-sync on connect:", err),
					);
				}
			})();
			return true;
		}

		if (message.type === "TRIGGER_SYNC") {
			(async () => {
				// Re-hydrate in-memory token if SW was restarted between polling check and click
				if (!cachedToken) {
					const { spotifyToken } =
						await chrome.storage.local.get("spotifyToken");
					if (spotifyToken) cachedToken = spotifyToken as SpotifyTokenPayload;
				}
				try {
					const result = await performSync();
					sendResponse({ ok: true, ...result });
				} catch (err) {
					const error = err instanceof Error ? err.message : "Unknown error";
					sendResponse({ ok: false, error });
				}
			})();
			return true;
		}

		if (message.type === "SPOTIFY_STATUS") {
			(async () => {
				const hasSession = await hasSpotifySession();
				if (!hasSession) {
					clearSpotifyTokenCache();
					sendResponse({ type: "SPOTIFY_STATUS", hasToken: false });
					return;
				}

				// Re-hydrate in-memory cache if SW was terminated and restarted
				if (!cachedToken) {
					const { spotifyToken } =
						await chrome.storage.local.get("spotifyToken");
					if (spotifyToken) cachedToken = spotifyToken as SpotifyTokenPayload;
				}

				const hasUsableToken =
					cachedToken !== null && isTokenValid() && !cachedToken.isAnonymous;
				if (!hasUsableToken && cachedToken) {
					clearSpotifyTokenCache();
				}

				sendResponse({
					type: "SPOTIFY_STATUS",
					hasToken: hasUsableToken,
					hasSession: true,
				});
			})();
			return true;
		}

		if (message.type === "SPOTIFY_COMMAND") {
			const parsed = parseSpotifyCommand(message);
			if (!parsed.ok) {
				const raw = message as { commandId?: unknown };
				const commandId =
					typeof raw.commandId === "string" ? raw.commandId : "invalid-command";
				sendResponse({
					ok: false,
					errorCode: "INVALID_PARAMS",
					message: parsed.error,
					retryable: false,
					commandId,
				});
				return true;
			}

			(async () => {
				const response = await handleSpotifyCommand(
					parsed.value,
					tokenProvider,
				);
				sendResponse(response);
			})();
			return true;
		}

		return false;
	},
);

chrome.runtime.onMessage.addListener(
	(message: ExtensionMessage, _sender, sendResponse) => {
		switch (message.type) {
			case "SPOTIFY_TOKEN": {
				cachedToken = message.payload;
				cachedProfile = null;
				// Persist so token survives service worker termination
				chrome.storage.local.set({ spotifyToken: message.payload });
				const expiresIn = Math.round(
					(message.payload.expiresAtMs - Date.now()) / 1000,
				);
				console.log(`[hearted.] Token received (expires in ${expiresIn}s)`);
				sendResponse({ ok: true });

				// Auto-sync when connected to the app and this is a real user token
				if (!message.payload.isAnonymous) {
					chrome.storage.local.get("apiToken", ({ apiToken }) => {
						if (apiToken && !isSyncing) {
							performSync().catch((err) =>
								console.error("[hearted.] Auto-sync on token:", err),
							);
						}
					});
				}
				break;
			}

			case "PATHFINDER_HASH": {
				const { operationName, sha256Hash } = message.payload;
				updateHash(operationName, sha256Hash);
				sendResponse({ ok: true });
				break;
			}

			case "GET_TOKEN": {
				sendResponse(
					isTokenValid()
						? { token: (cachedToken as SpotifyTokenPayload).accessToken }
						: { token: null },
				);
				break;
			}

			case "GET_STATUS": {
				(async () => {
					if (!cachedToken) {
						const { spotifyToken } =
							await chrome.storage.local.get("spotifyToken");
						if (spotifyToken) cachedToken = spotifyToken as SpotifyTokenPayload;
					}
					const state = await getSyncState();
					const response: StatusResponse = {
						hasToken: isTokenValid(),
						tokenExpiresAtMs: cachedToken?.expiresAtMs ?? null,
					};
					sendResponse({ ...response, sync: state });
				})();
				return true;
			}

			case "TRIGGER_SYNC": {
				(async () => {
					try {
						const result = await performSync();
						sendResponse({ ok: true, ...result });
					} catch (err) {
						const error = err instanceof Error ? err.message : "Unknown error";
						sendResponse({ ok: false, error });
					}
				})();
				return true;
			}
		}

		return true;
	},
);

// Real-time logout detection via sp_dc cookie; polling still reconciles within 3s.
chrome.cookies.onChanged.addListener((changeInfo) => {
	if (
		changeInfo.cookie.domain !== ".spotify.com" ||
		changeInfo.cookie.name !== "sp_dc"
	) {
		return;
	}

	// Ignore cookie refreshes implemented as overwrite remove+set events.
	if (changeInfo.removed && changeInfo.cause !== "overwrite") {
		clearSpotifyTokenCache();
		console.log("[hearted.] Spotify logout detected (sp_dc removed)");
	}
});
