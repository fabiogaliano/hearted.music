export type SyncStatus = "idle" | "syncing" | "done" | "error";

export type SyncState = {
	status: SyncStatus;
	fetched: number;
	total: number;
	lastSyncAt: number | null;
	error: string | null;
};

const DEFAULT_STATE: SyncState = {
	status: "idle",
	fetched: 0,
	total: 0,
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
