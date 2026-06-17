import { useSyncExternalStore } from "react";

/**
 * In-memory store (mirrored to sessionStorage) for the flag-playlists
 * rehearsal's flagged set.
 *
 * The demo lets the user flag playlists on the canned /playlists preview, then
 * uses that exact set to drive the canned match reveal several steps later
 * (match-walkthrough on /match). Those are separate routes that fully remount,
 * and the demo ids ("1"–"7") aren't real DB rows, so the set can't live in
 * component state or on the server — it lives here.
 *
 * It's mirrored to sessionStorage so it also survives a hard refresh. Without
 * that, reloading anywhere between flagging (step 2) and the reveal (step 5)
 * drops the set, and the reveal silently falls back to the picked song's own
 * curated matches instead of the playlists the user actually chose. sessionStorage
 * (not localStorage) scopes the set to the tab and clears itself when the tab
 * closes, so it never leaks into a later visit or into production.
 */

const STORAGE_KEY = "hearted:demo:flagged-playlists";

// Stable empty reference so useSyncExternalStore never sees a new identity for
// the empty state (the server snapshot and the pre-flag client state).
const EMPTY: readonly string[] = [];

let flaggedIds: readonly string[] = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function readStorage(): readonly string[] {
	try {
		const raw = window.sessionStorage.getItem(STORAGE_KEY);
		if (!raw) return EMPTY;
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string")) {
			return parsed.length > 0 ? (parsed as string[]) : EMPTY;
		}
		return EMPTY;
	} catch {
		return EMPTY;
	}
}

function writeStorage(ids: readonly string[]): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
	} catch {
		// sessionStorage can be unavailable (private mode, disabled, quota). The
		// in-memory value still drives the current session; we just forfeit
		// refresh-survival and fall back to the song's curated matches as before.
	}
}

// Rehydrate from sessionStorage on first client read. Done lazily (not at module
// load) so it stays a no-op during SSR and only touches storage in the browser,
// and only when the demo actually reads the set. The result is cached in
// `flaggedIds` so getSnapshot keeps returning a referentially-stable value, which
// useSyncExternalStore requires.
function ensureHydrated(): void {
	if (hydrated || typeof window === "undefined") return;
	hydrated = true;
	const stored = readStorage();
	if (stored.length > 0) flaggedIds = stored;
}

export function getFlaggedPlaylistIds(): readonly string[] {
	ensureHydrated();
	return flaggedIds;
}

export function setFlaggedPlaylistIds(ids: readonly string[]): void {
	// An explicit set is now the source of truth — no need to consult storage again.
	hydrated = true;
	flaggedIds = ids.length > 0 ? [...ids] : EMPTY;
	writeStorage(flaggedIds);
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function useFlaggedPlaylistIds(): readonly string[] {
	return useSyncExternalStore(subscribe, getFlaggedPlaylistIds, () => EMPTY);
}

/**
 * Per-playlist intent/genres the rehearsal collects, mirrored to sessionStorage
 * for the same reason as the flagged set: a hard refresh must not drop it. The
 * intent text isn't read downstream (the /match reveal scores off the flagged set
 * + curated matches, not the user's typed intent) — it's persisted so the
 * /playlists tour can derive the user's true position on resume. Without it, a
 * refresh after the first intent was saved can't tell "finished the cycle, now on
 * your own" from "added one, never described it", and re-guides or falsely hands
 * off. Persisting it makes the resumed step exact and keeps a described playlist
 * showing its description after the refresh.
 */

const METADATA_STORAGE_KEY = "hearted:demo:playlist-metadata";

export interface DemoPlaylistMetadata {
	intent: string | null;
	genres: string[];
}

type MetadataMap = Readonly<Record<string, DemoPlaylistMetadata>>;

// Stable empty reference, mirroring EMPTY above, so useSyncExternalStore never
// sees a fresh identity for the metadata-free state.
const EMPTY_METADATA: MetadataMap = {};

let metadata: MetadataMap = EMPTY_METADATA;
let metadataHydrated = false;
const metadataListeners = new Set<() => void>();

function isMetadata(value: unknown): value is DemoPlaylistMetadata {
	if (typeof value !== "object" || value === null) return false;
	const m = value as Record<string, unknown>;
	const intentOk = m.intent === null || typeof m.intent === "string";
	const genresOk =
		Array.isArray(m.genres) && m.genres.every((g) => typeof g === "string");
	return intentOk && genresOk;
}

function readMetadataStorage(): MetadataMap {
	try {
		const raw = window.sessionStorage.getItem(METADATA_STORAGE_KEY);
		if (!raw) return EMPTY_METADATA;
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return EMPTY_METADATA;
		const entries = Object.entries(parsed as Record<string, unknown>).filter(
			([, v]) => isMetadata(v),
		) as Array<[string, DemoPlaylistMetadata]>;
		return entries.length > 0 ? Object.fromEntries(entries) : EMPTY_METADATA;
	} catch {
		return EMPTY_METADATA;
	}
}

function writeMetadataStorage(value: MetadataMap): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(value));
	} catch {
		// Same trade-off as the flagged set: storage may be unavailable. The
		// in-memory value still drives the live session; we only forfeit
		// refresh-survival of the collected intents.
	}
}

function ensureMetadataHydrated(): void {
	if (metadataHydrated || typeof window === "undefined") return;
	metadataHydrated = true;
	const stored = readMetadataStorage();
	if (Object.keys(stored).length > 0) metadata = stored;
}

export function getDemoPlaylistMetadata(): MetadataMap {
	ensureMetadataHydrated();
	return metadata;
}

export function setDemoPlaylistMetadata(
	id: string,
	value: DemoPlaylistMetadata,
): void {
	metadataHydrated = true;
	metadata = { ...metadata, [id]: value };
	writeMetadataStorage(metadata);
	for (const listener of metadataListeners) listener();
}

function subscribeMetadata(listener: () => void): () => void {
	metadataListeners.add(listener);
	return () => {
		metadataListeners.delete(listener);
	};
}

export function useDemoPlaylistMetadata(): MetadataMap {
	return useSyncExternalStore(
		subscribeMetadata,
		getDemoPlaylistMetadata,
		() => EMPTY_METADATA,
	);
}
