/**
 * The flag-playlists rehearsal set must survive a hard refresh: the match reveal
 * several steps later reads it to show the playlists the user actually flagged,
 * not the picked song's generic curated matches. Persistence is via sessionStorage,
 * so a "refresh" here is a module reset (drops the in-memory set) while
 * sessionStorage — living on the jsdom window — persists across it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function importStore() {
	return import("../demoSandboxStore");
}

async function refreshStore() {
	vi.resetModules();
	return importStore();
}

beforeEach(() => {
	window.sessionStorage.clear();
	vi.resetModules();
});

afterEach(() => {
	window.sessionStorage.clear();
});

describe("demoSandboxStore", () => {
	it("re-hydrates the flagged set from sessionStorage after a refresh", async () => {
		const before = await importStore();
		before.setFlaggedPlaylistIds(["2", "5"]);
		expect(before.getFlaggedPlaylistIds()).toEqual(["2", "5"]);

		const after = await refreshStore();
		expect(after.getFlaggedPlaylistIds()).toEqual(["2", "5"]);
	});

	it("returns empty after a refresh when nothing was flagged", async () => {
		const store = await importStore();
		expect(store.getFlaggedPlaylistIds()).toEqual([]);
	});

	it("persists a cleared set, so a refresh sees nothing", async () => {
		const before = await importStore();
		before.setFlaggedPlaylistIds(["3"]);
		before.setFlaggedPlaylistIds([]);

		const after = await refreshStore();
		expect(after.getFlaggedPlaylistIds()).toEqual([]);
	});
});
