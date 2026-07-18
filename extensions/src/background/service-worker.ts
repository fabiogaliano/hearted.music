import {
	isAllowedBridgeOrigin,
	isBridgeEnvelope,
} from "../../../shared/extension-bridge-protocol";
import type {
	ExtensionSyncBackendFailureCode,
	ExtensionSyncBackendFailure as SyncBackendFailure,
} from "../../../shared/extension-sync-contract";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
	EXTENSION_SYNC_UNKNOWN_FAILURE,
} from "../../../shared/extension-sync-contract";
import type {
	ExtensionSyncDiagnosticOutcome,
	ExtensionSyncDiagnosticPhase,
	ExtensionSyncDiagnosticSummary,
} from "../../../shared/extension-sync-diagnostics";
import { mapWithConcurrency } from "../../../src/lib/shared/utils/concurrency";
import { browser } from "../shared/browser";
import { DEFAULT_BACKEND_URL } from "../shared/constants";
import { updateHash } from "../shared/hash-registry";
import {
	fetchAllLikedTracks,
	fetchPlaylistTracks,
	getCurrentUserProfile as fetchProfile,
	fetchUserPlaylists,
} from "../shared/spotify-client/reads";
import {
	getSpotifyRequestPolicy,
	resetSpotifyRequestStats,
	snapshotSpotifyRequestStats,
} from "../shared/spotify-request-policy";
import { getSyncState, setSyncState } from "../shared/storage";
import {
	enqueueSyncDiagnostic,
	flushPendingSyncDiagnostics,
} from "../shared/sync-diagnostics";
import type {
	HeartedAccountStatus,
	HeartedIdentity,
	SpotifyTokenPayload,
	UserProfile,
} from "../shared/types";
import type { DispatcherDeps } from "./dispatcher";
import { handleInboundMessage } from "./dispatcher";
import {
	acceptCreatedCandidate,
	applyNavigationUpdate,
	type CreatedTabCandidate,
	clearPendingLoginReturnIfTabClosed,
	consumePendingLoginReturnForSpotifyTab,
	getPendingLoginReturn,
	setPendingLoginReturnAwaitingCreatedTab,
} from "./expect-login-return";
import {
	hydrateLikedSongReleaseYears,
	recordReleaseYearLookups,
} from "./release-year-hydration";

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
const PLAYLIST_TRACK_FETCH_CONCURRENCY = 2;
// Kept in sync with manifest.externally_connectable.matches so we can fall
// back to querying by URL when the cached tab id is stale.
const HEARTED_TAB_URL_MATCHES = [
	"https://hearted.music/*",
	"https://*.hearted.music/*",
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
	const { backendUrl } = await browser.storage.local.get("backendUrl");
	if (isValidBackendUrl(backendUrl)) {
		return normalizeBackendUrl(backendUrl);
	}
	return DEFAULT_BACKEND_URL;
}

function clearSpotifyTokenCache(): void {
	cachedToken = null;
	cachedProfile = null;
	browser.storage.local.remove(["spotifyToken", "spotifyProfile"]);
}

async function hasSpotifySession(): Promise<boolean> {
	try {
		const cookie = await browser.cookies.get({
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
			await browser.tabs.get(heartedTabId);
			return heartedTabId;
		} catch {
			heartedTabId = null;
		}
	}
	try {
		const tabs = await browser.tabs.query({ url: HEARTED_TAB_URL_MATCHES });
		const first = tabs.find((t) => typeof t.id === "number");
		return first?.id ?? null;
	} catch {
		return null;
	}
}

async function sendShowReturnBannerToTab(spotifyTabId: number): Promise<void> {
	try {
		await browser.tabs.sendMessage(spotifyTabId, {
			type: "SHOW_RETURN_BANNER",
		});
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
// (the fire-and-forget arming race). Not persisted: browser.tabs.onCreated
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
		const tab = await browser.tabs.get(tabId);
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
		const tabs = await browser.tabs.query({ url: SPOTIFY_TAB_URL_MATCH });
		const tabIds = tabs.flatMap((tab) =>
			typeof tab.id === "number" ? [tab.id] : [],
		);
		await Promise.all(tabIds.map(sendShowReturnBannerToTab));
	} catch (err) {
		console.warn("[hearted.] debugBroadcastShowReturnBanner failed:", err);
	}
}

// Throttle failed profileAttributes fetches so a broken pathfinder hash or a
// flaky network doesn't turn every SPOTIFY_STATUS poll into a Spotify request.
let profileFetchFailedAtMs = 0;
const PROFILE_FETCH_RETRY_MS = 60_000;

/**
 * Cached-or-fetched Spotify profile for the current token. Persisted so the
 * popup and the web app's status poll get an instant answer; refetched only
 * when a new token arrives (the account behind it may have changed).
 */
async function getSpotifyProfile(): Promise<UserProfile | null> {
	await rehydrateTokenIfMissing();
	if (!isUsableToken(cachedToken)) return null;
	if (cachedProfile) return cachedProfile;
	const { spotifyProfile } = await browser.storage.local.get("spotifyProfile");
	if (spotifyProfile) {
		cachedProfile = spotifyProfile as UserProfile;
		return cachedProfile;
	}
	if (Date.now() - profileFetchFailedAtMs < PROFILE_FETCH_RETRY_MS) return null;
	try {
		const profile = await fetchProfile(
			(cachedToken as SpotifyTokenPayload).accessToken,
		);
		cachedProfile = profile;
		await browser.storage.local.set({ spotifyProfile: profile });
		return profile;
	} catch (err) {
		profileFetchFailedAtMs = Date.now();
		console.warn("[hearted.] Spotify profile fetch failed:", err);
		return null;
	}
}

/**
 * Who does the stored apiToken act as? Verified live against
 * GET /api/extension/status (which 401s on a revoked token); falls back to the
 * last cached identity when the backend is unreachable so the popup can still
 * name the account.
 */
async function getHeartedAccountStatus(): Promise<HeartedAccountStatus> {
	const { apiToken, heartedAccount } = await browser.storage.local.get([
		"apiToken",
		"heartedAccount",
	]);
	if (!apiToken) return { state: "disconnected" };
	const backendUrl = await getBackendUrl();
	try {
		// The popup awaits this before rendering — cap the wait so a hung
		// backend degrades to the cached identity instead of a stuck spinner.
		const res = await fetch(`${backendUrl}/api/extension/status`, {
			headers: { Authorization: `Bearer ${apiToken}` },
			signal: AbortSignal.timeout(4_000),
		});
		if (res.status === 401) return { state: "revoked" };
		if (!res.ok) throw new Error(`Backend HTTP ${res.status}`);
		const body = (await res.json()) as {
			displayName?: string | null;
			imageUrl?: string | null;
			spotifyId?: string | null;
		};
		const account: HeartedIdentity = {
			displayName: body.displayName ?? null,
			imageUrl: body.imageUrl ?? null,
			spotifyId: body.spotifyId ?? null,
		};
		await browser.storage.local.set({ heartedAccount: account });
		return { state: "connected", account, verified: true };
	} catch {
		const cached = (heartedAccount ?? null) as HeartedIdentity | null;
		return {
			state: "connected",
			account: cached ?? { displayName: null, imageUrl: null, spotifyId: null },
			verified: false,
		};
	}
}

async function isPaired(): Promise<boolean> {
	const { apiToken } = await browser.storage.local.get("apiToken");
	return Boolean(apiToken);
}

async function disconnectHearted(): Promise<void> {
	await browser.storage.local.remove(["apiToken", "heartedAccount"]);
	console.log("[hearted.] Hearted pairing forgotten (apiToken cleared)");
}

async function disconnectSpotify(): Promise<void> {
	// Drops the captured token + profile only — the browser's own Spotify
	// session (sp_dc) is untouched, so opening Spotify reconnects immediately.
	clearSpotifyTokenCache();
	console.log("[hearted.] Spotify session forgotten (token cache cleared)");
}

async function getApiToken(): Promise<string> {
	const { apiToken } = await browser.storage.local.get("apiToken");
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

function truncateDiagnosticError(message: string | null): string | null {
	if (message === null) return null;
	return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

async function sendSyncDiagnostic(
	diagnostic: ExtensionSyncDiagnosticSummary,
): Promise<Response> {
	return postToBackend("/api/extension/status", {
		...diagnostic,
		requestStats: { ...diagnostic.requestStats },
		requestPolicy: { ...diagnostic.requestPolicy },
	});
}

type SyncResult =
	| {
			kind: "success";
			count: number;
			backendResult?: unknown;
	  }
	| {
			kind: "backend-failure";
			count: number;
			failure: SyncBackendFailure;
	  };

function isBackendFailureCode(
	value: unknown,
): value is ExtensionSyncBackendFailureCode {
	return (
		value === EXTENSION_SYNC_ALREADY_RUNNING ||
		value === EXTENSION_SYNC_COOLDOWN ||
		value === EXTENSION_SYNC_UNKNOWN_FAILURE
	);
}

function parseRetryAfterSeconds(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	return Math.ceil(value);
}

function parseBackendFailure(
	status: number,
	payload: unknown,
	response: Response,
): SyncBackendFailure {
	const retryAfterHeader = response.headers.get("Retry-After");
	const retryAfterFromHeader = retryAfterHeader
		? parseRetryAfterSeconds(Number(retryAfterHeader))
		: null;

	if (typeof payload !== "object" || payload === null) {
		return {
			status,
			code: EXTENSION_SYNC_UNKNOWN_FAILURE,
			message: null,
			retryAfterSeconds: retryAfterFromHeader,
		};
	}

	const code = Reflect.get(payload, "code");
	const error = Reflect.get(payload, "error");
	const retryAfterSeconds = parseRetryAfterSeconds(
		Reflect.get(payload, "retryAfterSeconds"),
	);

	return {
		status,
		code: isBackendFailureCode(code) ? code : EXTENSION_SYNC_UNKNOWN_FAILURE,
		message: typeof error === "string" ? error : null,
		retryAfterSeconds: retryAfterSeconds ?? retryAfterFromHeader,
	};
}

async function performSync(): Promise<SyncResult> {
	if (!isTokenValid()) throw new Error("No valid token");
	if (isSyncing) {
		throw new Error("Sync already in progress");
	}
	isSyncing = true;
	const token = (cachedToken as SpotifyTokenPayload).accessToken;
	const syncStartedAtMs = Date.now();
	const extensionVersion = browser.runtime.getManifest().version;
	const diagnosticId = crypto.randomUUID();
	const clientCreatedAt = new Date(syncStartedAtMs).toISOString();
	let diagnosticOutcome: ExtensionSyncDiagnosticOutcome = "extension_failure";
	let diagnosticPhase: ExtensionSyncDiagnosticPhase = "likedSongs";
	let diagnosticErrorMessage: string | null = null;
	let diagnosticBackendStatus: number | null = null;
	let diagnosticBackendFailureCode: ExtensionSyncBackendFailureCode | null =
		null;
	let diagnosticRetryAfterSeconds: number | null = null;
	let likedSongsCount = 0;
	let playlistCount = 0;
	let playlistsWithTracksCount = 0;
	let playlistTracksCount = 0;
	let failedPlaylistTrackFetchCount = 0;
	let skippedEmptyPlaylistsCount = 0;
	resetSpotifyRequestStats();
	console.log(
		"[hearted.] Starting sync with conservative Spotify request policy:",
		getSpotifyRequestPolicy(),
	);
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
			await browser.storage.local.set({ spotifyProfile: cachedProfile });
			console.log(`[hearted.] Current user: ${cachedProfile.displayName}`);
		}
		// local ref survives cachedProfile being nulled by incoming SPOTIFY_TOKEN messages
		const profile = cachedProfile;

		diagnosticPhase = "likedSongs";
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
		likedSongsCount = likedSongs.length;

		diagnosticPhase = "playlists";
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
		playlistCount = playlists.length;
		const userProfile = profile;
		// Only skip the network read for playlists we *know* are empty. A null
		// track_count means "unknown", so those are still fetched — collapsing
		// unknown into empty would silently never sync them.
		const playlistsToFetchTracks = playlists.filter(
			(playlist) => playlist.track_count == null || playlist.track_count > 0,
		);
		const knownEmptyPlaylists = playlists.filter(
			(playlist) => playlist.track_count === 0,
		);
		playlistsWithTracksCount = playlistsToFetchTracks.length;
		const skippedEmptyPlaylists = knownEmptyPlaylists.length;
		skippedEmptyPlaylistsCount = skippedEmptyPlaylists;
		if (skippedEmptyPlaylists > 0) {
			console.log(
				`[hearted.] Skipping track reads for ${skippedEmptyPlaylists} empty playlists`,
			);
		}
		diagnosticPhase = "playlistTracks";
		const playlistTracksTotal = playlistsToFetchTracks.reduce(
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

		const playlistTrackEntries = await mapWithConcurrency(
			playlistsToFetchTracks,
			PLAYLIST_TRACK_FETCH_CONCURRENCY,
			async (playlist) => {
				try {
					let currentPlaylistTrackCount = 0;
					const tracks = await fetchPlaylistTracks(
						token,
						`spotify:playlist:${playlist.id}`,
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
					return { playlistSpotifyId: playlist.id, tracks };
				} catch (err) {
					failedPlaylistTrackFetchCount += 1;
					console.warn(
						`[hearted.] Failed to fetch tracks for ${playlist.name}:`,
						err,
					);
					return null;
				}
			},
		);
		// Known-empty playlists get an explicit empty entry rather than being
		// omitted: the worker only reconciles playlists present in this list, so
		// a missing entry would leave previously-synced tracks orphaned when a
		// playlist is emptied between syncs.
		const playlistTracks = [
			...playlistTrackEntries.flatMap((entry) => (entry ? [entry] : [])),
			...knownEmptyPlaylists.map((playlist) => ({
				playlistSpotifyId: playlist.id,
				tracks: [] as Awaited<ReturnType<typeof fetchPlaylistTracks>>,
			})),
		];

		const playlistTrackIdsWithReleaseYear = new Set(
			playlistTracks.flatMap((entry) =>
				entry.tracks.flatMap((track) =>
					track.track.release_year != null ? [track.track.id] : [],
				),
			),
		);
		// Playlist tracks can already carry release_year inline, so hydrate liked
		// songs only after that free enrichment is known; otherwise we'd waste the
		// budget on overlap instead of true liked-only gaps.
		const { likedSongs: hydratedLikedSongs, lookups: releaseYearLookups } =
			await hydrateLikedSongReleaseYears(
				token,
				likedSongs,
				playlistTrackIdsWithReleaseYear,
				postToBackend,
			);

		const totalTracks = playlistTracks.reduce(
			(sum, pt) => sum + pt.tracks.length,
			0,
		);
		playlistTracksCount = totalTracks;
		console.log(
			`[hearted.] Sync fetch complete: ${likedSongs.length} liked songs, ${playlists.length} playlists, ${totalTracks} playlist tracks`,
		);

		diagnosticPhase = "uploading";
		await setSyncState({ phase: "uploading" });

		try {
			const res = await postToBackend("/api/extension/sync", {
				likedSongs: hydratedLikedSongs,
				playlists,
				playlistTracks,
				userProfile,
			});
			if (res.ok) {
				const result = await res.json();
				if (releaseYearLookups.length > 0) {
					try {
						await recordReleaseYearLookups(postToBackend, releaseYearLookups);
					} catch (error) {
						console.warn(
							"[hearted.] Failed to persist release-year hydration attempts:",
							error,
						);
					}
				}
				diagnosticOutcome = "success";
				await setSyncState({
					status: "done",
					phase: "idle",
					fetched: likedSongs.length,
					total: likedSongs.length,
					lastSyncAt: Date.now(),
				});
				console.log("[hearted.] Backend sync result:", result);
				return {
					kind: "success",
					count: likedSongs.length,
					backendResult: result,
				};
			}

			let payload: unknown = null;
			try {
				payload = await res.json();
			} catch {
				payload = null;
			}
			const failure = parseBackendFailure(res.status, payload, res);
			diagnosticOutcome = "backend_failure";
			diagnosticBackendStatus = failure.status;
			diagnosticBackendFailureCode = failure.code;
			diagnosticRetryAfterSeconds = failure.retryAfterSeconds;
			diagnosticErrorMessage = truncateDiagnosticError(
				failure.message ?? `Backend HTTP ${res.status}`,
			);
			await setSyncState({
				status: "error",
				error: failure.message ?? `Backend HTTP ${res.status}`,
			});
			console.warn("[hearted.] Backend sync failed:", failure);
			return { kind: "backend-failure", count: likedSongs.length, failure };
		} catch {
			diagnosticOutcome = "backend_failure";
			diagnosticErrorMessage = "Backend unreachable";
			await setSyncState({ status: "error", error: "Backend unreachable" });
			console.warn("[hearted.] Backend unreachable");
			throw new Error("Backend unreachable");
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : "Unknown error";
		// TS narrows diagnosticOutcome to its initializer here, but the "Backend
		// unreachable" path can already have set "backend_failure" before
		// re-throwing — preserve that classification instead of clobbering it.
		if (
			(diagnosticOutcome as ExtensionSyncDiagnosticOutcome) !==
			"backend_failure"
		) {
			diagnosticOutcome = "extension_failure";
		}
		diagnosticErrorMessage ??= truncateDiagnosticError(error);
		await setSyncState({ status: "error", error });
		console.error("[hearted.] Sync failed:", error);
		throw err;
	} finally {
		const spotifyRequestStats = snapshotSpotifyRequestStats();
		const diagnostic: ExtensionSyncDiagnosticSummary = {
			id: diagnosticId,
			clientCreatedAt,
			extensionVersion,
			outcome: diagnosticOutcome,
			phase: diagnosticPhase,
			backendStatus: diagnosticBackendStatus,
			backendFailureCode: diagnosticBackendFailureCode,
			retryAfterSeconds: diagnosticRetryAfterSeconds,
			errorMessage: truncateDiagnosticError(diagnosticErrorMessage),
			durationMs: Date.now() - syncStartedAtMs,
			likedSongsCount,
			playlistCount,
			playlistsWithTracksCount,
			playlistTracksCount,
			failedPlaylistTrackFetchCount,
			skippedEmptyPlaylistsCount,
			requestStats: spotifyRequestStats,
			requestPolicy: getSpotifyRequestPolicy(),
		};
		console.log("[hearted.] Spotify request stats:", {
			...spotifyRequestStats,
			wallTimeMs: diagnostic.durationMs,
		});
		try {
			await enqueueSyncDiagnostic(diagnostic);
			void flushPendingSyncDiagnostics(sendSyncDiagnostic).catch((error) => {
				console.warn("[hearted.] Failed to flush sync diagnostics:", error);
			});
		} catch (error) {
			console.warn("[hearted.] Failed to persist sync diagnostic:", error);
		}
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
	await browser.storage.local.remove("spotifyToken");
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

browser.runtime.onInstalled.addListener(async (details) => {
	console.log("[hearted.] Extension installed:", details.reason);

	// Re-inject content scripts into existing Spotify tabs so token
	// interception resumes without requiring a manual page refresh.
	try {
		const tabs = await browser.tabs.query({
			url: "https://open.spotify.com/*",
		});
		const tabIds = tabs.flatMap((tab) =>
			typeof tab.id === "number" ? [tab.id] : [],
		);
		await Promise.all(
			tabIds.map(async (tabId) => {
				await browser.scripting.executeScript({
					target: { tabId },
					files: ["content/intercept-token.js"],
					world: "MAIN",
				});
				await browser.scripting.executeScript({
					target: { tabId },
					files: ["content/spotify-token.js"],
				});
				await browser.scripting.executeScript({
					target: { tabId },
					files: ["content/return-banner.js"],
				});
				console.log("[hearted.] Re-injected content scripts into tab", tabId);
			}),
		);
	} catch (err) {
		console.warn("[hearted.] Failed to re-inject content scripts:", err);
	}
});

// Wires the module's mutable state (cachedToken/cachedProfile, tab tracking,
// pending-login-return state machine) into the capabilities the unified
// dispatcher needs. Built once — the dispatcher itself stays pure/testable,
// while all the WebExtension side effects live here.
async function rehydrateTokenIfMissing(): Promise<void> {
	if (cachedToken) return;
	const { spotifyToken } = await browser.storage.local.get("spotifyToken");
	if (spotifyToken) cachedToken = spotifyToken as SpotifyTokenPayload;
}

async function handleSpotifyTokenMessage(
	payload: SpotifyTokenPayload,
	sender: chrome.runtime.MessageSender,
): Promise<void> {
	// Detect login transition: check BOTH in-memory and persisted token so a
	// service-worker restart mid-session isn't misread as a fresh login.
	let prevUsable = isUsableToken(cachedToken);
	if (!prevUsable) {
		const { spotifyToken } = await browser.storage.local.get("spotifyToken");
		prevUsable = isUsableToken(
			(spotifyToken ?? null) as SpotifyTokenPayload | null,
		);
	}
	const nextUsable = isUsableToken(payload);

	cachedToken = payload;
	cachedProfile = null;
	// A new token can belong to a different Spotify account, so the persisted
	// profile must be refetched, not reused.
	await browser.storage.local.remove("spotifyProfile");
	await browser.storage.local.set({ spotifyToken: payload });
	const expiresIn = Math.round((payload.expiresAtMs - Date.now()) / 1000);
	console.log(`[hearted.] Token received (expires in ${expiresIn}s)`);

	// Only a fresh login transition (unusable → usable) should consume
	// pending login-return state; refreshes of an already-usable token must not.
	if (prevUsable || !nextUsable) return;
	const spotifyTabId = sender.tab?.id;
	if (typeof spotifyTabId !== "number") return;

	// Race fix: token can arrive before browser.tabs.onUpdated has had a
	// chance to confirm this same tab reached open.spotify.com. Run the
	// candidate-navigation reconciliation here so pending state advances
	// awaitingSpotifyNavigation → awaitingToken, and only then attempt to
	// consume.
	await reconcileCandidateTabNavigation(spotifyTabId);
	// Dual-match consume: pending awaitingToken state must match BOTH the
	// bound tab AND the arm token reported by that tab's content script. If
	// ARM_TOKEN_PRESENT hasn't arrived yet, this returns false; the eventual
	// ARM_TOKEN_PRESENT handler retries the consume.
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
		// Either the tab is unrelated, the arm token hasn't been reported yet,
		// or it doesn't match. Pending state (if any) is left intact for the
		// legitimate matched tab.
		console.log(
			"[hearted.] Spotify login transition — no dual-match, skipping banner",
		);
	}
}

async function handleArmTokenPresent(
	token: string,
	sender: chrome.runtime.MessageSender,
): Promise<void> {
	const senderTabId = sender.tab?.id;
	if (typeof senderTabId !== "number") return;
	rememberReportedArmToken(senderTabId, token);

	// Retry consume in case SPOTIFY_TOKEN already arrived for this tab (which
	// would have left pending state in awaitingToken with no reported arm
	// token to dual-match against). This makes the flow robust to either
	// ordering of ARM_TOKEN_PRESENT vs SPOTIFY_TOKEN.
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
}

async function closeAndFocusHearted(
	sender: chrome.runtime.MessageSender,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const spotifyTabId = sender.tab?.id;
	const targetId = await resolveHeartedTabId();
	try {
		if (targetId !== null) {
			const tab = await browser.tabs.get(targetId);
			await browser.tabs.update(targetId, { active: true });
			if (typeof tab.windowId === "number") {
				await browser.windows.update(tab.windowId, { focused: true });
			}
		}
		// Remove Spotify tab AFTER focusing hearted so Chrome doesn't briefly
		// activate an adjacent tab during the transition.
		if (typeof spotifyTabId === "number") {
			await browser.tabs.remove(spotifyTabId);
		}
		return { ok: true };
	} catch (err) {
		const error = err instanceof Error ? err.message : "Unknown error";
		console.warn("[hearted.] CLOSE_AND_FOCUS_HEARTED failed:", error);
		return { ok: false, error };
	}
}

const dispatcherDeps: DispatcherDeps = {
	isValidBackendUrl,
	normalizeBackendUrl,
	setConnectStorage: async ({ apiToken, backendUrl }) => {
		const storagePayload: Record<string, string> = { apiToken };
		if (backendUrl !== undefined) storagePayload.backendUrl = backendUrl;
		await browser.storage.local.set(storagePayload);
		// A fresh pairing may act as a different hearted account — drop the
		// cached identity so GET_ACCOUNTS re-verifies against the backend.
		await browser.storage.local.remove("heartedAccount");
		console.log(
			`[hearted.] Connected with API token from web app (${backendUrl ?? DEFAULT_BACKEND_URL})`,
		);
	},
	rehydrateTokenIfMissing,
	flushPendingSyncDiagnostics: () => {
		void flushPendingSyncDiagnostics(sendSyncDiagnostic).catch((error) => {
			console.warn(
				"[hearted.] Failed to flush pending sync diagnostics:",
				error,
			);
		});
	},
	performSync,
	hasSpotifySession,
	clearSpotifyTokenCache,
	isTokenValid,
	getCachedToken: () => cachedToken,
	getSyncState,
	armLoginReturn: async ({ originTabId, originWindowId, armToken }) => {
		await setPendingLoginReturnAwaitingCreatedTab({
			originTabId,
			originWindowId,
			armToken,
			armedAtMs: Date.now(),
		});
	},
	reconcileArmedCandidates: async ({ originTabId, originWindowId }) => {
		// Race fix: the new tab may have been created before this fire-and-
		// forget message reached the SW. Back-scan the recent-creations buffer
		// and adopt the most recent qualifying candidate. This only advances
		// to awaitingSpotifyNavigation — final binding still requires
		// browser.tabs.onUpdated to confirm the candidate reaches Spotify.
		const pending = await getPendingLoginReturn();
		if (!pending || pending.kind !== "awaitingCreatedTab") return;
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
	},
	handleSpotifyTokenMessage,
	updatePathfinderHash: ({ operationName, sha256Hash }) => {
		updateHash(operationName, sha256Hash);
	},
	handleArmTokenPresent,
	closeAndFocusHearted,
	getSpotifyProfile,
	getHeartedAccountStatus,
	isPaired,
	disconnectSpotify,
	disconnectHearted,
	tokenProvider,
};

// Chrome front door. Note: Firefox also exposes onMessageExternal (for
// extension→extension messaging; only the web-page direction is unimplemented,
// bug 1319168), so this listener registers there too. Chrome restricts callers
// to the externally_connectable matches for free; Firefox has no such filter,
// so vet the sender ourselves — a hearted web page carries an allow-listed
// origin and no extension id, while another extension would carry an id. The
// web app routes through the bridge envelope in the onMessage listener below.
if (browser.runtime.onMessageExternal) {
	browser.runtime.onMessageExternal.addListener(
		(message, sender, sendResponse) => {
			if (
				sender.id !== undefined ||
				!sender.origin ||
				!isAllowedBridgeOrigin(sender.origin)
			) {
				return false;
			}
			// Only the vetted web-app front door may claim the "hearted tab" slot —
			// content-script senders (Spotify tabs) must never overwrite it, or
			// CLOSE_AND_FOCUS_HEARTED would focus the Spotify tab it's about to close.
			rememberHeartedSender(sender);
			handleInboundMessage(message, sender, dispatcherDeps)
				// Always respond, even for unknown types (undefined) or handler
				// failures — leaving the channel open would hang the page's callback
				// until the worker is torn down.
				.then((response) => sendResponse(response))
				.catch((err: unknown) => {
					sendResponse({
						ok: false,
						error: err instanceof Error ? err.message : String(err),
					});
				});
			return true;
		},
	);
}

browser.runtime.onMessage.addListener(
	(message: unknown, sender, sendResponse) => {
		// Firefox front door: web-app commands relayed by the app-bridge content
		// script. Returning the promise makes browser.* deliver the resolved value
		// back to the bridge, which posts it to the page. (This branch never fires
		// on Chrome — the bridge content script is Firefox-only.)
		if (isBridgeEnvelope(message)) {
			// Bridge envelopes are relayed from the hearted web page, so the sender
			// tab is a legitimate hearted tab (unlike other content-script messages).
			rememberHeartedSender(sender);
			return handleInboundMessage(message.payload, sender, dispatcherDeps);
		}

		// Extension-internal messages: content scripts and the popup, both on
		// Chrome and Firefox. Same unified dispatcher as the web-app front doors.
		handleInboundMessage(message, sender, dispatcherDeps)
			.then((response) => sendResponse(response))
			.catch((err: unknown) => {
				sendResponse({
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				});
			});
		return true;
	},
);

// Tab-creation: record into the back-scan buffer (so a slightly-later
// EXPECT_LOGIN_RETURN can still find this tab) and, if pending state is
// awaitingCreatedTab, try to *adopt* the candidate. Adoption only advances
// to awaitingSpotifyNavigation — final binding requires onUpdated below.
browser.tabs.onCreated.addListener((tab) => {
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
browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
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
browser.tabs.onRemoved.addListener((closedTabId) => {
	forgetReportedArmToken(closedTabId);
	clearPendingLoginReturnIfTabClosed(closedTabId).catch((err) => {
		console.warn("[hearted.] tabs.onRemoved cleanup failed:", err);
	});
});

// Real-time logout detection via sp_dc cookie; polling still reconciles within 3s.
browser.cookies.onChanged.addListener((changeInfo) => {
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
