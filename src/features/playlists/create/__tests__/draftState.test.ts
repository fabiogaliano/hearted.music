/**
 * Tests for the draft selection state transitions.
 *
 * These test the pure logic of addSong / removeSong transitions without
 * mounting a React component or making any network calls. The logic is
 * extracted here to mirror what useCreatePlaylistDraft does internally.
 */

import { describe, expect, it } from "vitest";

// --- Mirrored pure selection state logic ---
// These mirror the reducer logic inside useCreatePlaylistDraft callbacks
// so we can unit-test it without mounting React.

interface SelectionState {
	pinnedSongIds: string[];
	excludedSongIds: string[];
}

function removeSong(state: SelectionState, id: string): SelectionState {
	return {
		pinnedSongIds: state.pinnedSongIds.filter((pid) => pid !== id),
		excludedSongIds: state.excludedSongIds.includes(id)
			? state.excludedSongIds
			: [...state.excludedSongIds, id],
	};
}

function addSong(state: SelectionState, id: string): SelectionState {
	return {
		pinnedSongIds: state.pinnedSongIds.includes(id)
			? state.pinnedSongIds
			: [...state.pinnedSongIds, id],
		excludedSongIds: state.excludedSongIds.filter((eid) => eid !== id),
	};
}

const emptyState: SelectionState = {
	pinnedSongIds: [],
	excludedSongIds: [],
};

describe("removeSong", () => {
	it("adds the song id to excludedSongIds", () => {
		const next = removeSong(emptyState, "song-01");
		expect(next.excludedSongIds).toContain("song-01");
	});

	it("removes the song from pinnedSongIds if it was pinned", () => {
		const state: SelectionState = {
			pinnedSongIds: ["song-01", "song-02"],
			excludedSongIds: [],
		};
		const next = removeSong(state, "song-01");
		expect(next.pinnedSongIds).not.toContain("song-01");
		expect(next.pinnedSongIds).toContain("song-02");
	});

	it("does not duplicate excludedSongIds if already excluded", () => {
		const state: SelectionState = {
			pinnedSongIds: [],
			excludedSongIds: ["song-01"],
		};
		const next = removeSong(state, "song-01");
		expect(next.excludedSongIds.filter((id) => id === "song-01")).toHaveLength(
			1,
		);
	});

	it("leaves other songs untouched", () => {
		const state: SelectionState = {
			pinnedSongIds: ["song-02"],
			excludedSongIds: ["song-03"],
		};
		const next = removeSong(state, "song-01");
		expect(next.pinnedSongIds).toContain("song-02");
		expect(next.excludedSongIds).toContain("song-03");
	});
});

describe("addSong", () => {
	it("adds the song id to pinnedSongIds", () => {
		const next = addSong(emptyState, "song-01");
		expect(next.pinnedSongIds).toContain("song-01");
	});

	it("removes the song from excludedSongIds if it was excluded", () => {
		const state: SelectionState = {
			pinnedSongIds: [],
			excludedSongIds: ["song-01", "song-02"],
		};
		const next = addSong(state, "song-01");
		expect(next.excludedSongIds).not.toContain("song-01");
		expect(next.excludedSongIds).toContain("song-02");
	});

	it("does not duplicate pinnedSongIds if already pinned", () => {
		const state: SelectionState = {
			pinnedSongIds: ["song-01"],
			excludedSongIds: [],
		};
		const next = addSong(state, "song-01");
		expect(next.pinnedSongIds.filter((id) => id === "song-01")).toHaveLength(1);
	});

	it("leaves other songs untouched", () => {
		const state: SelectionState = {
			pinnedSongIds: ["song-02"],
			excludedSongIds: ["song-03"],
		};
		const next = addSong(state, "song-01");
		expect(next.pinnedSongIds).toContain("song-02");
		expect(next.excludedSongIds).toContain("song-03");
	});
});

describe("add → remove round-trip", () => {
	it("a song added then removed ends up excluded, not pinned", () => {
		let state = emptyState;
		state = addSong(state, "song-01");
		state = removeSong(state, "song-01");

		expect(state.pinnedSongIds).not.toContain("song-01");
		expect(state.excludedSongIds).toContain("song-01");
	});
});

describe("remove → add round-trip", () => {
	it("a song removed then re-added ends up pinned, not excluded", () => {
		let state = emptyState;
		state = removeSong(state, "song-01");
		state = addSong(state, "song-01");

		expect(state.pinnedSongIds).toContain("song-01");
		expect(state.excludedSongIds).not.toContain("song-01");
	});
});
