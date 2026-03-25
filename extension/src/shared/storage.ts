export type SyncStatus = "idle" | "syncing" | "done" | "error";

export type SyncPhase =
	| "idle"
	| "likedSongs"
	| "playlists"
	| "playlistTracks"
	| "artistImages"
	| "uploading";

export type SyncCounter = {
	fetched: number;
	total: number;
};

export type SyncState = {
	status: SyncStatus;
	phase: SyncPhase;
	fetched: number;
	total: number;
	likedSongs: SyncCounter;
	playlists: SyncCounter;
	playlistTracks: SyncCounter;
	artistImages: SyncCounter;
	lastSyncAt: number | null;
	error: string | null;
};

const EMPTY_COUNTER: SyncCounter = {
	fetched: 0,
	total: 0,
};

const DEFAULT_STATE: SyncState = {
	status: "idle",
	phase: "idle",
	fetched: 0,
	total: 0,
	likedSongs: EMPTY_COUNTER,
	playlists: EMPTY_COUNTER,
	playlistTracks: EMPTY_COUNTER,
	artistImages: EMPTY_COUNTER,
	lastSyncAt: null,
	error: null,
};

const STORAGE_KEY = "syncState";

export async function getSyncState(): Promise<SyncState> {
	const result = await chrome.storage.local.get(STORAGE_KEY);
	return result[STORAGE_KEY] ?? DEFAULT_STATE;
}

export async function setSyncState(
	update: Partial<SyncState>,
): Promise<SyncState> {
	const current = await getSyncState();
	const next = { ...current, ...update };
	await chrome.storage.local.set({ [STORAGE_KEY]: next });
	return next;
}
