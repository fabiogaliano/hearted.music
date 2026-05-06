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
import {
	attachArtistDataToTracks,
	fetchArtistData,
} from "./artist-image-hydration";
import { handleSpotifyCommand } from "./command-handler";
import {
	acceptCreatedCandidate,
	applyNavigationUpdate,
	type CreatedTabCandidate,
	clearPendingLoginReturnIfTabClosed,
	consumePendingLoginReturnForSpotifyTab,
	getPendingLoginReturn,
	setPendingLoginReturnAwaitingCreatedTab,
} from "./expect-login-return";

let cachedToken: SpotifyTokenPayload | null = null;
let cachedProfile: UserProfile | null = null;
let isSyncing = false;

// Track the hearted. tab that's talking to us so we can return focus after a
// Spotify login. Refreshed on every externally_connectable message.
let heartedTabId: number | null = null;
let heartedTabLastSeenAt = 0;
const HEARTED_TAB_FRESHNESS_MS = 60_000;

const SPOTIFY_COOKIE_URL = "https://open.spotify.com/";
const SPOTIFY_TAB_URL_MATCH = "https://open.spotify.com/*";
// Kept in sync with manifest.externally_connectable.matches so we can fall
// back to querying by URL when the cached tab id is stale.
const HEARTED_TAB_URL_MATCHES = [
	"https://hearted.app/*",
	"https://*.hearted.app/*",
	"http://localhost/*",
	"http://127.0.0.1/*",
];

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

function isUsableToken(token: SpotifyTokenPayload | null | undefined): boolean {
	if (!token) return false;
	if (token.isAnonymous) return false;
	return Date.now() < token.expiresAtMs;
}

function rememberHeartedSender(sender: chrome.runtime.MessageSender): void {
	if (sender.tab?.id !== undefined) {
		heartedTabId = sender.tab.id;
		heartedTabLastSeenAt = Date.now();
	}
}

async function resolveHeartedTabId(): Promise<number | null> {
	if (
		heartedTabId !== null &&
		Date.now() - heartedTabLastSeenAt < HEARTED_TAB_FRESHNESS_MS
	) {
		try {
			await chrome.tabs.get(heartedTabId);
			return heartedTabId;
		} catch {
			heartedTabId = null;
		}
	}
	try {
		const tabs = await chrome.tabs.query({ url: HEARTED_TAB_URL_MATCHES });
		const first = tabs.find((t) => typeof t.id === "number");
		return first?.id ?? null;
	} catch {
		return null;
	}
}

async function sendShowReturnBannerToTab(spotifyTabId: number): Promise<void> {
	try {
		await chrome.tabs.sendMessage(spotifyTabId, { type: "SHOW_RETURN_BANNER" });
	} catch (err) {
		// With document_start injection this should usually succeed. Failures here
		// are more likely extension reload / tab close / tab race conditions, so
		// log them for visibility during preprod hardening.
		console.warn(
			`[hearted.] SHOW_RETURN_BANNER failed for tab ${spotifyTabId}:`,
			err,
		);
	}
}

// In-memory ring buffer of recent tab creations. Used at arm time to back-scan
// for tabs that opened *just before* the EXPECT_LOGIN_RETURN message arrived
// (the fire-and-forget arming race). Not persisted: chrome.tabs.onCreated
// itself keeps the SW alive long enough for typical click→message latency.
const RECENT_TAB_CREATIONS_MAX = 16;
const RECENT_TAB_CREATIONS_MAX_AGE_MS = 10_000;
const recentTabCreations: CreatedTabCandidate[] = [];

// In-memory tab→armToken map populated by ARM_TOKEN_PRESENT messages from
// open.spotify.com content scripts. Consulted (not consumed) when deciding
// whether a SPOTIFY_TOKEN event from a given tab should claim pending state.
// Keyed by sender tab id. TTL matches the long awaitingToken window so slow
// token capture still works; stale entries are also pruned on tab close and
// via lazy expiry on read.
const REPORTED_ARM_TOKEN_TTL_MS = 10 * 60_000;
type ReportedArmToken = { token: string; reportedAtMs: number };
const reportedArmTokensByTabId = new Map<number, ReportedArmToken>();

function rememberReportedArmToken(tabId: number, token: string): void {
	reportedArmTokensByTabId.set(tabId, { token, reportedAtMs: Date.now() });
}

function getReportedArmToken(tabId: number): string | null {
	const entry = reportedArmTokensByTabId.get(tabId);
	if (!entry) return null;
	if (Date.now() - entry.reportedAtMs > REPORTED_ARM_TOKEN_TTL_MS) {
		reportedArmTokensByTabId.delete(tabId);
		return null;
	}
	return entry.token;
}

function forgetReportedArmToken(tabId: number): void {
	reportedArmTokensByTabId.delete(tabId);
}

function recordRecentTabCreation(creation: CreatedTabCandidate): void {
	const now = Date.now();
	while (
		recentTabCreations.length > 0 &&
		now - recentTabCreations[0].createdAtMs > RECENT_TAB_CREATIONS_MAX_AGE_MS
	) {
		recentTabCreations.shift();
	}
	while (recentTabCreations.length >= RECENT_TAB_CREATIONS_MAX) {
		recentTabCreations.shift();
	}
	recentTabCreations.push(creation);
}

function tabToCandidate(
	tab: chrome.tabs.Tab,
	createdAtMs: number,
): CreatedTabCandidate | null {
	if (typeof tab.id !== "number") return null;
	return {
		tabId: tab.id,
		windowId: tab.windowId,
		openerTabId: tab.openerTabId,
		url: tab.url,
		pendingUrl: tab.pendingUrl,
		createdAtMs,
	};
}

function findMostRecentCreationByTabId(
	tabId: number,
): CreatedTabCandidate | null {
	for (let i = recentTabCreations.length - 1; i >= 0; i -= 1) {
		const candidate = recentTabCreations[i];
		if (candidate.tabId === tabId) return candidate;
	}
	return null;
}

function logNavigationUpdateResult(
	tabId: number,
	result: Awaited<ReturnType<typeof applyNavigationUpdate>>,
): void {
	if (result === "cleared") {
		console.log(
			`[hearted.] Candidate tab ${tabId} navigated away from Spotify; cleared pending state`,
		);
		return;
	}
	if (result && result.kind === "awaitingToken") {
		console.log(
			`[hearted.] Candidate tab ${tabId} confirmed on Spotify; awaiting token`,
		);
	}
}

async function reconcileCandidateTabNavigation(tabId: number): Promise<void> {
	try {
		const tab = await chrome.tabs.get(tabId);
		const existingCandidate = findMostRecentCreationByTabId(tabId);
		if (existingCandidate) {
			existingCandidate.url = tab.url;
			existingCandidate.pendingUrl = tab.pendingUrl;
			existingCandidate.openerTabId = tab.openerTabId;

			const adopted = await acceptCreatedCandidate(existingCandidate);
			if (adopted?.kind === "awaitingSpotifyNavigation") {
				console.log(
					`[hearted.] Candidate tab ${tabId} adopted during reconciliation`,
				);
			}
		}

		const result = await applyNavigationUpdate({
			tabId,
			url: tab.url,
			pendingUrl: tab.pendingUrl,
		});
		logNavigationUpdateResult(tabId, result);
	} catch {
		await clearPendingLoginReturnIfTabClosed(tabId);
	}
}

// Debug-only: blast every open Spotify tab with the banner. Used by
// `dbg.showReturnBanner` for visual tweaking; never on the production path.
async function debugBroadcastShowReturnBanner(): Promise<void> {
	try {
		const tabs = await chrome.tabs.query({ url: SPOTIFY_TAB_URL_MATCH });
		for (const tab of tabs) {
			if (typeof tab.id === "number") await sendShowReturnBannerToTab(tab.id);
		}
	} catch (err) {
		console.warn("[hearted.] debugBroadcastShowReturnBanner failed:", err);
	}
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
	await setSyncState({
		status: "syncing",
		phase: "likedSongs",
		fetched: 0,
		total: 0,
		likedSongs: { fetched: 0, total: 0 },
		playlists: { fetched: 0, total: 0 },
		playlistTracks: { fetched: 0, total: 0 },
		artistImages: { fetched: 0, total: 0 },
		error: null,
	});
	try {
		if (!cachedProfile) {
			cachedProfile = await fetchProfile(token);
			console.log(`[hearted.] Current user: ${cachedProfile.displayName}`);
		}
		// local ref survives cachedProfile being nulled by incoming SPOTIFY_TOKEN messages
		const profile = cachedProfile;

		const likedSongs = await fetchAllLikedTracks(
			token,
			async (fetched, total) => {
				await setSyncState({
					phase: "likedSongs",
					fetched,
					total,
					likedSongs: { fetched, total },
				});
			},
		);

		const userUri = `spotify:user:${profile.spotifyId}`;
		const playlists = await fetchUserPlaylists(
			token,
			userUri,
			async (fetched, total) => {
				await setSyncState({
					phase: "playlists",
					fetched,
					total,
					playlists: { fetched, total },
				});
			},
		);
		await setSyncState({
			phase: "playlists",
			fetched: playlists.length,
			total: playlists.length,
			playlists: { fetched: playlists.length, total: playlists.length },
		});
		const userProfile = profile;
		const playlistTracksTotal = playlists.reduce(
			(sum, playlist) => sum + (playlist.track_count ?? 0),
			0,
		);
		let fetchedPlaylistTracks = 0;
		await setSyncState({
			phase: "playlistTracks",
			fetched: fetchedPlaylistTracks,
			total: playlistTracksTotal,
			playlistTracks: {
				fetched: fetchedPlaylistTracks,
				total: playlistTracksTotal,
			},
		});

		// Fetch tracks for all owned playlists
		const playlistTracks: Array<{
			playlistSpotifyId: string;
			tracks: Awaited<ReturnType<typeof fetchPlaylistTracks>>;
		}> = [];
		for (const pl of playlists) {
			try {
				let currentPlaylistTrackCount = 0;
				const tracks = await fetchPlaylistTracks(
					token,
					`spotify:playlist:${pl.id}`,
					async (playlistFetched) => {
						fetchedPlaylistTracks +=
							playlistFetched - currentPlaylistTrackCount;
						currentPlaylistTrackCount = playlistFetched;
						await setSyncState({
							phase: "playlistTracks",
							fetched: fetchedPlaylistTracks,
							total: playlistTracksTotal,
							playlistTracks: {
								fetched: fetchedPlaylistTracks,
								total: playlistTracksTotal,
							},
						});
					},
				);
				playlistTracks.push({ playlistSpotifyId: pl.id, tracks });
			} catch (err) {
				console.warn(`[hearted.] Failed to fetch tracks for ${pl.name}:`, err);
			}
		}

		const totalTracks = playlistTracks.reduce(
			(sum, pt) => sum + pt.tracks.length,
			0,
		);
		console.log(
			`[hearted.] Sync complete: ${likedSongs.length} liked songs, ${playlists.length} playlists, ${totalTracks} playlist tracks`,
		);

		const artistResults = await fetchArtistData({
			token,
			tracks: [
				...likedSongs,
				...playlistTracks.flatMap((entry) => entry.tracks),
			],
			postToBackend,
		});
		const hydratedLikedSongs = attachArtistDataToTracks(
			likedSongs,
			artistResults,
		);
		const hydratedPlaylistTracks = playlistTracks.map((entry) => ({
			...entry,
			tracks: attachArtistDataToTracks(entry.tracks, artistResults),
		}));
		await setSyncState({ phase: "uploading" });

		try {
			const res = await postToBackend("/api/extension/sync", {
				likedSongs: hydratedLikedSongs,
				playlists,
				playlistTracks: hydratedPlaylistTracks,
				userProfile,
			});
			if (res.ok) {
				const result = await res.json();
				await setSyncState({
					status: "done",
					phase: "idle",
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
	resetSpotify: () => Promise<unknown>;
	showReturnBanner: () => Promise<unknown>;
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

// Clear the extension's view of the Spotify session so the next authorized
// fetch on open.spotify.com is treated as a fresh login transition. Does NOT
// touch the sp_dc cookie — the browser stays signed in.
dbg.resetSpotify = async () => {
	clearSpotifyTokenCache();
	await chrome.storage.local.remove("spotifyToken");
	console.log(
		"[hearted.] Spotify token cache cleared — reload the Spotify tab to re-trigger login detection.",
	);
	return { ok: true };
};

// Force-show the return banner on every open.spotify.com tab. Useful for
// tweaking visuals without re-running the full login flow.
dbg.showReturnBanner = async () => {
	await debugBroadcastShowReturnBanner();
	return { ok: true };
};

const tokenProvider = {
	getCachedToken: () => cachedToken,
	setCachedToken: (token: SpotifyTokenPayload) => {
		cachedToken = token;
	},
	isTokenValid,
	clearCachedToken: clearSpotifyTokenCache,
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
			await chrome.scripting.executeScript({
				target: { tabId: tab.id },
				files: ["content/return-banner.js"],
			});
			console.log("[hearted.] Re-injected content scripts into tab", tab.id);
		}
	} catch (err) {
		console.warn("[hearted.] Failed to re-inject content scripts:", err);
	}
});

chrome.runtime.onMessageExternal.addListener(
	(message, _sender, sendResponse) => {
		rememberHeartedSender(_sender);

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

		if (message.type === "EXPECT_LOGIN_RETURN") {
			(async () => {
				const originTabId = _sender.tab?.id;
				const originWindowId = _sender.tab?.windowId;
				const armToken =
					typeof message.armToken === "string" ? message.armToken : "";
				if (
					typeof originTabId !== "number" ||
					typeof originWindowId !== "number"
				) {
					// External arming must come from a hearted tab — without tab+window
					// ids we cannot scope binding to that window, so refuse to arm.
					sendResponse({ ok: false, error: "no sender tab/window" });
					return;
				}
				if (armToken.length === 0) {
					// Without an arm token we can't dual-match the eventual fragment
					// reported by the Spotify tab. Refuse rather than arm a flow that
					// could not be safely consumed.
					sendResponse({ ok: false, error: "missing armToken" });
					return;
				}
				const armedAtMs = Date.now();
				await setPendingLoginReturnAwaitingCreatedTab({
					originTabId,
					originWindowId,
					armToken,
					armedAtMs,
				});

				// Race fix: the new tab may have been created before this fire-and-
				// forget message reached the SW. Back-scan the recent-creations buffer
				// and adopt the most recent qualifying candidate. This only advances
				// to awaitingSpotifyNavigation — final binding still requires
				// chrome.tabs.onUpdated to confirm the candidate reaches Spotify.
				const pending = await getPendingLoginReturn();
				if (pending && pending.kind === "awaitingCreatedTab") {
					for (let i = recentTabCreations.length - 1; i >= 0; i -= 1) {
						const candidate = recentTabCreations[i];
						if (candidate.windowId !== originWindowId) continue;
						if (
							candidate.openerTabId !== undefined &&
							candidate.openerTabId !== originTabId
						) {
							continue;
						}
						await reconcileCandidateTabNavigation(candidate.tabId);
						const after = await getPendingLoginReturn();
						if (after?.kind !== "awaitingCreatedTab") break;
					}
				}
				sendResponse({ ok: true });
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

		if (message.type === "GET_STATUS") {
			(async () => {
				if (!cachedToken) {
					const { spotifyToken } =
						await chrome.storage.local.get("spotifyToken");
					if (spotifyToken) cachedToken = spotifyToken as SpotifyTokenPayload;
				}
				const state = await getSyncState();
				sendResponse({
					hasToken: isTokenValid(),
					tokenExpiresAtMs: cachedToken?.expiresAtMs ?? null,
					sync: state,
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
				(async () => {
					// Detect login transition: check BOTH in-memory and persisted token so
					// a service-worker restart mid-session isn't misread as a fresh login.
					let prevUsable = isUsableToken(cachedToken);
					if (!prevUsable) {
						const { spotifyToken } =
							await chrome.storage.local.get("spotifyToken");
						prevUsable = isUsableToken(
							(spotifyToken ?? null) as SpotifyTokenPayload | null,
						);
					}
					const nextUsable = isUsableToken(message.payload);

					cachedToken = message.payload;
					cachedProfile = null;
					await chrome.storage.local.set({ spotifyToken: message.payload });
					const expiresIn = Math.round(
						(message.payload.expiresAtMs - Date.now()) / 1000,
					);
					console.log(`[hearted.] Token received (expires in ${expiresIn}s)`);

					if (!prevUsable && nextUsable) {
						const spotifyTabId = _sender.tab?.id;
						if (typeof spotifyTabId === "number") {
							// Race fix: token can arrive before chrome.tabs.onUpdated has had
							// a chance to confirm this same tab reached open.spotify.com. Run
							// the candidate-navigation reconciliation here so pending state
							// advances awaitingSpotifyNavigation → awaitingToken, and only
							// then attempt to consume.
							await reconcileCandidateTabNavigation(spotifyTabId);
							// Dual-match consume: pending awaitingToken state must match BOTH
							// the bound tab AND the arm token reported by that tab's content
							// script. If ARM_TOKEN_PRESENT hasn't arrived yet, this returns
							// false; the eventual ARM_TOKEN_PRESENT handler retries the consume.
							const reportedArmToken = getReportedArmToken(spotifyTabId);
							const matched = await consumePendingLoginReturnForSpotifyTab(
								spotifyTabId,
								reportedArmToken,
							);
							if (matched) {
								console.log(
									"[hearted.] Spotify login transition — matched bound tab + arm token, sending banner",
								);
								forgetReportedArmToken(spotifyTabId);
								await sendShowReturnBannerToTab(spotifyTabId);
							} else {
								// Either the tab is unrelated, the arm token hasn't been
								// reported yet, or it doesn't match. Pending state (if any) is
								// left intact for the legitimate matched tab.
								console.log(
									"[hearted.] Spotify login transition — no dual-match, skipping banner",
								);
							}
						}
					}

					sendResponse({ ok: true });
				})();
				return true;
			}

			case "PATHFINDER_HASH": {
				const { operationName, sha256Hash } = message.payload;
				updateHash(operationName, sha256Hash);
				sendResponse({ ok: true });
				break;
			}

			case "ARM_TOKEN_PRESENT": {
				(async () => {
					const senderTabId = _sender.tab?.id;
					const token = message.token;
					if (
						typeof senderTabId !== "number" ||
						typeof token !== "string" ||
						token.length === 0
					) {
						sendResponse({ ok: false });
						return;
					}
					rememberReportedArmToken(senderTabId, token);

					// Retry consume in case SPOTIFY_TOKEN already arrived for this tab
					// (which would have left pending state in awaitingToken with no
					// reported arm token to dual-match against). This makes the flow
					// robust to either ordering of ARM_TOKEN_PRESENT vs SPOTIFY_TOKEN.
					const matched = await consumePendingLoginReturnForSpotifyTab(
						senderTabId,
						token,
					);
					if (matched) {
						console.log(
							"[hearted.] Arm token reported after token capture — dual-match satisfied, sending banner",
						);
						forgetReportedArmToken(senderTabId);
						await sendShowReturnBannerToTab(senderTabId);
					}
					sendResponse({ ok: true });
				})();
				return true;
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

			case "CLOSE_AND_FOCUS_HEARTED": {
				(async () => {
					const spotifyTabId = _sender.tab?.id;
					const targetId = await resolveHeartedTabId();
					try {
						if (targetId !== null) {
							const tab = await chrome.tabs.get(targetId);
							await chrome.tabs.update(targetId, { active: true });
							if (typeof tab.windowId === "number") {
								await chrome.windows.update(tab.windowId, { focused: true });
							}
						}
						// Remove Spotify tab AFTER focusing hearted so Chrome doesn't
						// briefly activate an adjacent tab during the transition.
						if (typeof spotifyTabId === "number") {
							await chrome.tabs.remove(spotifyTabId);
						}
						sendResponse({ ok: true });
					} catch (err) {
						const error = err instanceof Error ? err.message : "Unknown error";
						console.warn("[hearted.] CLOSE_AND_FOCUS_HEARTED failed:", error);
						sendResponse({ ok: false, error });
					}
				})();
				return true;
			}
		}

		return true;
	},
);

// Tab-creation: record into the back-scan buffer (so a slightly-later
// EXPECT_LOGIN_RETURN can still find this tab) and, if pending state is
// awaitingCreatedTab, try to *adopt* the candidate. Adoption only advances
// to awaitingSpotifyNavigation — final binding requires onUpdated below.
chrome.tabs.onCreated.addListener((tab) => {
	const candidate = tabToCandidate(tab, Date.now());
	if (!candidate) return;
	recordRecentTabCreation(candidate);

	(async () => {
		await reconcileCandidateTabNavigation(candidate.tabId);
	})().catch((err) => {
		console.warn("[hearted.] tabs.onCreated adopt failed:", err);
	});
});

// Tab-update: drives the navigation-confirmation step. Only relevant while
// pending state is awaitingSpotifyNavigation, and only for the candidate
// tab id. Spotify destination → awaitingToken; clearly-non-Spotify → drop
// pending; about:blank / accounts.spotify.com → keep waiting.
chrome.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
	(async () => {
		const update = {
			tabId,
			url: tab.url,
			pendingUrl: tab.pendingUrl,
		};
		const result = await applyNavigationUpdate(update);
		logNavigationUpdateResult(tabId, result);

		if (result !== null) return;

		const pending = await getPendingLoginReturn();
		if (
			pending?.kind !== "awaitingCreatedTab" &&
			pending?.kind !== "awaitingSpotifyNavigation"
		) {
			return;
		}

		const existing = findMostRecentCreationByTabId(tabId);
		if (existing === null) return;

		const candidate: CreatedTabCandidate = existing;
		candidate.url = tab.url;
		candidate.pendingUrl = tab.pendingUrl;
		candidate.openerTabId = tab.openerTabId;

		const adopted = await acceptCreatedCandidate(candidate);
		if (adopted?.kind !== "awaitingSpotifyNavigation") return;

		console.log(
			`[hearted.] tabs.onUpdated adopted candidate tab ${candidate.tabId}`,
		);
		const postAdoptionResult = await applyNavigationUpdate(update);
		logNavigationUpdateResult(tabId, postAdoptionResult);
	})().catch((err) => {
		console.warn("[hearted.] tabs.onUpdated nav handling failed:", err);
	});
});

// If the candidate or bound Spotify tab is closed before the flow completes,
// drop pending state so a future token from another tab can't claim it.
chrome.tabs.onRemoved.addListener((closedTabId) => {
	forgetReportedArmToken(closedTabId);
	clearPendingLoginReturnIfTabClosed(closedTabId).catch((err) => {
		console.warn("[hearted.] tabs.onRemoved cleanup failed:", err);
	});
});

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
