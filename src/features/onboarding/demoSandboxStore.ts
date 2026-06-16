import { useSyncExternalStore } from "react";

/**
 * In-memory store for the flag-playlists rehearsal's flagged set.
 *
 * The demo lets the user flag playlists on the canned /playlists preview, then
 * uses that exact set to drive the canned match reveal several steps later
 * (match-walkthrough on /match). Those are separate routes that fully remount,
 * and the demo ids ("1"–"7") aren't real DB rows, so the set can't live in
 * component state or on the server — it lives here. It survives client-side
 * navigation across the whole demo and resets on a hard refresh (the reveal
 * falls back to the song's curated matches when the set is empty).
 */

let flaggedIds: readonly string[] = [];
const listeners = new Set<() => void>();

// Stable empty reference for the server snapshot so useSyncExternalStore never
// sees a new identity during SSR/hydration.
const EMPTY: readonly string[] = [];

export function getFlaggedPlaylistIds(): readonly string[] {
	return flaggedIds;
}

export function setFlaggedPlaylistIds(ids: readonly string[]): void {
	flaggedIds = [...ids];
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
