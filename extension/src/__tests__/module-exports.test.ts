import { describe, it, expect } from "vitest";

describe("sync pipeline components", () => {
	it("reads module exports expected sync functions", async () => {
		const reads = await import("../shared/spotify-client/reads");
		expect(reads.getCurrentUserProfile).toBeTypeOf("function");
		expect(reads.fetchAllLikedTracks).toBeTypeOf("function");
		expect(reads.fetchUserPlaylists).toBeTypeOf("function");
		expect(reads.fetchPlaylistTracks).toBeTypeOf("function");
	});

	it("sync state module exports get/set functions", async () => {
		const storage = await import("../shared/storage");
		expect(storage.getSyncState).toBeTypeOf("function");
		expect(storage.setSyncState).toBeTypeOf("function");
	});

	it("command handler module exports handleSpotifyCommand", async () => {
		const handler = await import("../background/command-handler");
		expect(handler.handleSpotifyCommand).toBeTypeOf("function");
	});
});
