import type {
	ExtensionMessage,
	SpotifyTokenPayload,
	StatusResponse,
} from "../shared/types";
import { getSyncState, setSyncState } from "../shared/storage";

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
const LIKED_TRACKS_HASH =
	"087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240";

let cachedToken: SpotifyTokenPayload | null = null;

function isTokenValid(): boolean {
	return cachedToken !== null && Date.now() < cachedToken.expiresAtMs;
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

function buildTracksQuery(offset: number, limit: number) {
	return {
		variables: { offset, limit },
		operationName: "fetchLibraryTracks",
		extensions: {
			persistedQuery: { version: 1, sha256Hash: LIKED_TRACKS_HASH },
		},
	};
}

async function fetchPage(
	token: string,
	offset: number,
	limit: number,
): Promise<any> {
	const res = await fetch(PATHFINDER_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(buildTracksQuery(offset, limit)),
	});

	if (res.status === 429) {
		const retryAfter = Number(res.headers.get("Retry-After") || "5");
		console.log(`[hearted.] Rate limited, retrying in ${retryAfter}s`);
		await new Promise((r) => setTimeout(r, retryAfter * 1000));
		return fetchPage(token, offset, limit);
	}

	if (!res.ok) {
		throw new Error(`Pathfinder API error: ${res.status}`);
	}

	return res.json();
}

async function fetchAllLikedTracks(
	token: string,
	onProgress: (fetched: number, total: number) => void,
): Promise<any[]> {
	const allItems: any[] = [];
	let offset = 0;
	const limit = 50;
	let total = Infinity;

	while (offset < total) {
		const data = await fetchPage(token, offset, limit);
		const tracks = data.data?.me?.library?.tracks ?? data.data;
		const items = tracks?.items ?? [];
		total = tracks?.totalCount ?? items.length;

		allItems.push(...items);
		offset += limit;

		onProgress(allItems.length, total);
		console.log(`[hearted.] Fetched ${allItems.length}/${total} tracks`);

		if (offset < total) {
			await new Promise((r) => setTimeout(r, 200));
		}
	}

	return allItems;
}

// Debug helpers (callable from SW console)
(self as any).testFetch = async () => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	const data = await fetchPage(cachedToken!.accessToken, 0, 5);
	console.log("[hearted.] Raw response:", data);
	return data;
};

(self as any).triggerSync = async () => {
	if (!isTokenValid()) return console.error("[hearted.] No valid token");
	await setSyncState({ status: "syncing", fetched: 0, total: 0, error: null });
	try {
		const items = await fetchAllLikedTracks(
			cachedToken!.accessToken,
			async (fetched, total) => {
				await setSyncState({ fetched, total });
			},
		);
		await chrome.storage.local.set({ likedTracks: items });
		await setSyncState({
			status: "done",
			fetched: items.length,
			total: items.length,
			lastSyncAt: Date.now(),
		});
		console.log(`[hearted.] Sync complete: ${items.length} items stored`);
		return items.length;
	} catch (err) {
		const error = err instanceof Error ? err.message : "Unknown error";
		await setSyncState({ status: "error", error });
		console.error("[hearted.] Sync failed:", error);
	}
};

chrome.runtime.onInstalled.addListener((details) => {
	console.log("[hearted.] Extension installed:", details.reason);
});

chrome.runtime.onMessage.addListener(
	(message: ExtensionMessage, _sender, sendResponse) => {
		switch (message.type) {
			case "SPOTIFY_TOKEN": {
				cachedToken = message.payload;
				const expiresIn = Math.round(
					(message.payload.expiresAtMs - Date.now()) / 1000,
				);
				console.log(`[hearted.] Token received (expires in ${expiresIn}s)`);
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
				getSyncState().then((state) => {
					const response: StatusResponse = {
						hasToken: isTokenValid(),
						tokenExpiresAtMs: cachedToken?.expiresAtMs ?? null,
					};
					sendResponse({ ...response, sync: state });
				});
				return true;
			}

			case "TRIGGER_SYNC": {
				if (!isTokenValid()) {
					sendResponse({ ok: false, error: "No valid token" });
					break;
				}

				(async () => {
					try {
						await setSyncState({
							status: "syncing",
							fetched: 0,
							total: 0,
							error: null,
						});
						const items = await fetchAllLikedTracks(
							cachedToken!.accessToken,
							async (fetched, total) => {
								await setSyncState({ fetched, total });
							},
						);
						await chrome.storage.local.set({ likedTracks: items });
						await setSyncState({
							status: "done",
							fetched: items.length,
							total: items.length,
							lastSyncAt: Date.now(),
						});
						console.log(
							`[hearted.] Sync complete: ${items.length} items stored`,
						);
						sendResponse({ ok: true, count: items.length });
					} catch (err) {
						const error = err instanceof Error ? err.message : "Unknown error";
						await setSyncState({ status: "error", error });
						console.error("[hearted.] Sync failed:", error);
						sendResponse({ ok: false, error });
					}
				})();
				return true;
			}
		}

		return true;
	},
);
