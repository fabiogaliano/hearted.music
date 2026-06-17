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
