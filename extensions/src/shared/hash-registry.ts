import { browser } from "./browser";

export const DEFAULT_HASHES: Record<string, string> = {
	fetchLibraryTracks:
		"087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240",
	libraryV3: "973e511ca44261fda7eebac8b653155e7caee3675abb4fb110cc1b8c78b091c3",
	fetchPlaylistContents:
		"a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4",
	fetchPlaylist:
		"a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4",
	profileAttributes:
		"b197b5adb4b761690f76ad9d9fb278c14c14e7331f357c04a56e7001af7106e0",
	// Shared hash: Spotify bundles add/remove into one persisted query, routing by operationName.
	// Verified 2026-03-07 — wrong hash returns 412 "Invalid query hash", shared hash returns 200 for both.
	addToPlaylist:
		"47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990",
	removeFromPlaylist:
		"47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990",
	// moveItemsInPlaylist shares the same persisted query as add/remove — Spotify
	// bundles all three into one query, routing by operationName (verified 2026-06-23).
	moveItemsInPlaylist:
		"47b2a1234b17748d332dd0431534f22450e9ecbb3d5ddcdacbd83368636a0990",
	queryArtistOverview:
		"ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a",
	getTrack: "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294",
} as const;

const STORAGE_KEY = "hashRegistry";

const runtimeHashes = new Map<string, string>();
let loaded = false;

async function loadFromStorage(): Promise<void> {
	if (loaded) return;
	const result = await browser.storage.local.get(STORAGE_KEY);
	const stored: Record<string, string> | undefined = result[STORAGE_KEY];
	if (stored) {
		for (const [key, value] of Object.entries(stored)) {
			runtimeHashes.set(key, value);
		}
	}
	loaded = true;
}

export async function getHash(operationName: string): Promise<string> {
	const cached = runtimeHashes.get(operationName);
	if (cached) return cached;

	await loadFromStorage();

	const fromStorage = runtimeHashes.get(operationName);
	if (fromStorage) return fromStorage;

	const fallback = DEFAULT_HASHES[operationName];
	if (fallback) return fallback;

	throw new Error(
		`[hearted.] Unknown operation: ${operationName} — no hash in storage or defaults`,
	);
}

export async function updateHash(
	operationName: string,
	hash: string,
): Promise<void> {
	await loadFromStorage();

	const previous = runtimeHashes.get(operationName);
	runtimeHashes.set(operationName, hash);

	if (previous !== hash) {
		console.log(
			`[hearted.] Hash updated: ${operationName} → ${hash.substring(0, 16)}...`,
		);
	}

	const result = await browser.storage.local.get(STORAGE_KEY);
	const stored: Record<string, string> = result[STORAGE_KEY] ?? {};
	stored[operationName] = hash;
	await browser.storage.local.set({ [STORAGE_KEY]: stored });
}
