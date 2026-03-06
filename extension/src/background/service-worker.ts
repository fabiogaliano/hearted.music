import type {
	ExtensionMessage,
	SpotifyTokenPayload,
	SpotifyTrackDTO,
	SpotifyPlaylistDTO,
	StatusResponse,
	UserProfile,
} from "../shared/types";
import { getSyncState, setSyncState } from "../shared/storage";
import { updateHash } from "../shared/hash-registry";
import { queryPathfinder } from "../shared/pathfinder";
import {
	extractId,
	mapPathfinderTrack,
	mapPathfinderPlaylist,
	mapPathfinderPlaylistTrack,
} from "../shared/mappers";
import { DEFAULT_BACKEND_URL } from "../shared/constants";

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

type ProfileResponse = {
	data: {
		me: {
			profile: {
				uri: string;
				name: string;
				username: string;
				avatar: {
					sources: Array<{ url: string; width: number; height: number }>;
				} | null;
			};
		};
	};
};

async function getCurrentUserProfile(token: string): Promise<UserProfile> {
	if (cachedProfile) return cachedProfile;
	const data = await queryPathfinder<ProfileResponse>(
		token,
		"profileAttributes",
		{},
	);
	const profile = data.data.me.profile;
	const avatarSources = profile.avatar?.sources ?? [];
	// Pick the largest avatar (last in sources array, or sort by width)
	const largestAvatar =
		avatarSources.length > 0
			? avatarSources.reduce((best, s) => (s.width > best.width ? s : best))
			: null;

	cachedProfile = {
		spotifyId: extractId(profile.uri),
		displayName: profile.name,
		username: profile.username,
		avatarUrl: largestAvatar?.url ?? null,
	};
	console.log(
		`[hearted.] Current user: ${cachedProfile.displayName} (${profile.uri})`,
	);
	return cachedProfile;
}

type LikedTracksResponse = {
	data: {
		me: {
			library: {
				tracks: {
					items: Array<Record<string, any>>;
					totalCount: number;
					pagingInfo: { offset: number; limit: number };
				};
			};
		};
	};
};

type LibraryV3Response = {
	data: {
		me: {
			libraryV3: {
				items: Array<Record<string, any>>;
				totalCount: number;
				pagingInfo: { offset: number; limit: number };
			};
		};
	};
};

async function fetchAllLikedTracks(
	token: string,
	onProgress: (fetched: number, total: number) => void,
): Promise<SpotifyTrackDTO[]> {
	const allTracks: SpotifyTrackDTO[] = [];
	let offset = 0;
	const limit = 50;
	let total = Infinity;

	while (offset < total) {
		const data = await queryPathfinder<LikedTracksResponse>(
			token,
			"fetchLibraryTracks",
			{ offset, limit },
		);
		const tracks = data.data?.me?.library?.tracks;
		const items = tracks?.items ?? [];
		total = tracks?.totalCount ?? items.length;

		const mapped = items
			.map(mapPathfinderTrack)
			.filter((t): t is SpotifyTrackDTO => t !== null);
		allTracks.push(...mapped);
		offset += limit;

		onProgress(allTracks.length, total);
		console.log(`[hearted.] Fetched ${allTracks.length}/${total} liked tracks`);

		if (offset < total) {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	return allTracks;
}

async function fetchUserPlaylists(
	token: string,
): Promise<SpotifyPlaylistDTO[]> {
	const profile = await getCurrentUserProfile(token);
	const userUri = `spotify:user:${profile.spotifyId}`;
	const allPlaylists: SpotifyPlaylistDTO[] = [];
	let offset = 0;
	const limit = 50;
	let total = Infinity;

	while (offset < total) {
		const data = await queryPathfinder<LibraryV3Response>(token, "libraryV3", {
			filters: ["Playlists"],
			order: null,
			textFilter: "",
			features: ["LIKED_SONGS", "YOUR_EPISODES_V2", "PRERELEASES", "EVENTS"],
			limit,
			offset,
			flatten: true,
			expandedFolders: [],
			folderUri: null,
			includeFoldersWhenFlattening: true,
		});
		const library = data.data?.me?.libraryV3;
		const items = library?.items ?? [];
		total = library?.totalCount ?? items.length;

		const mapped = items
			.filter((item: any) => {
				const typename = item.item?.data?.__typename;
				if (typename !== "Playlist") return false;
				const ownerUri = item.item?.data?.ownerV2?.data?.uri;
				return ownerUri === userUri;
			})
			.map(mapPathfinderPlaylist);
		allPlaylists.push(...mapped);
		offset += limit;

		console.log(
			`[hearted.] Fetched ${allPlaylists.length} owned playlists (scanned ${offset}/${total})`,
		);

		if (offset < total) {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	return allPlaylists;
}

type PlaylistContentsResponse = {
	data: {
		playlistV2: {
			content: {
				items: Array<Record<string, any>>;
				totalCount: number;
				pagingInfo: { offset: number; limit: number };
			};
		};
	};
};

async function fetchPlaylistTracks(
	token: string,
	playlistUri: string,
): Promise<SpotifyTrackDTO[]> {
	const allTracks: SpotifyTrackDTO[] = [];
	let offset = 0;
	const limit = 50;
	let total = Infinity;

	while (offset < total) {
		const data = await queryPathfinder<PlaylistContentsResponse>(
			token,
			"fetchPlaylistContents",
			{ uri: playlistUri, offset, limit },
		);
		const content = data.data?.playlistV2?.content;
		const items = content?.items ?? [];
		total = content?.totalCount ?? items.length;

		const mapped = items
			.map(mapPathfinderPlaylistTrack)
			.filter((t: any): t is SpotifyTrackDTO => t !== null);
		allTracks.push(...mapped);
		offset += limit;

		console.log(`[hearted.] Playlist tracks: ${allTracks.length}/${total}`);

		if (offset < total) {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	return allTracks;
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

	await setSyncState({ status: "syncing", fetched: 0, total: 0, error: null });

	try {
		const likedSongs = await fetchAllLikedTracks(
			cachedToken!.accessToken,
			async (fetched, total) => {
				await setSyncState({ fetched, total });
			},
		);

		const playlists = await fetchUserPlaylists(cachedToken!.accessToken);
		const userProfile = cachedProfile;

		await setSyncState({
			status: "done",
			fetched: likedSongs.length,
			total: likedSongs.length,
			lastSyncAt: Date.now(),
		});
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
				console.log("[hearted.] Backend sync result:", result);
				return { count: likedSongs.length, backendResult: result };
			} else {
				console.warn(`[hearted.] Backend sync failed: ${res.status}`);
				return { count: likedSongs.length, backendError: `HTTP ${res.status}` };
			}
		} catch {
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
(self as any).testFetch = async () => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	const data = await queryPathfinder(
		cachedToken!.accessToken,
		"fetchLibraryTracks",
		{ offset: 0, limit: 5 },
	);
	console.log("[hearted.] Raw response:", data);
	return data;
};

(self as any).triggerSync = async () => {
	try {
		const result = await performSync();
		console.log(`[hearted.] triggerSync result:`, result);
		return result;
	} catch (err) {
		console.error("[hearted.] triggerSync error:", err);
	}
};

(self as any).fetchPlaylists = async () => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	const playlists = await fetchUserPlaylists(cachedToken!.accessToken);
	console.log("[hearted.] Playlists:", playlists);
	return playlists;
};

(self as any).getProfile = async () => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	const profile = await getCurrentUserProfile(cachedToken!.accessToken);
	console.log("[hearted.] Profile:", profile);
	return profile;
};

(self as any).fetchPlaylistTracks = async (playlistUri: string) => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	const tracks = await fetchPlaylistTracks(
		cachedToken!.accessToken,
		playlistUri,
	);
	console.log("[hearted.] Playlist tracks:", tracks);
	return tracks;
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
						? { token: cachedToken!.accessToken }
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
