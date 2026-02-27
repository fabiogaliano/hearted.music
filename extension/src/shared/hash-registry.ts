export const DEFAULT_HASHES: Record<string, string> = {
	fetchLibraryTracks:
		"087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240",
	libraryV3: "9f4da031f81274d572cfedaf6fc57a737c84b43d572952200b2c36aaa8fec1c6",
	fetchPlaylistContents:
		"9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f",
	profileAttributes:
		"53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced",
} as const;

const STORAGE_KEY = "hashRegistry";

const runtimeHashes = new Map<string, string>();
let loaded = false;

async function loadFromStorage(): Promise<void> {
	if (loaded) return;
	const result = await chrome.storage.local.get(STORAGE_KEY);
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

	const result = await chrome.storage.local.get(STORAGE_KEY);
	const stored: Record<string, string> = result[STORAGE_KEY] ?? {};
	stored[operationName] = hash;
	await chrome.storage.local.set({ [STORAGE_KEY]: stored });
}
