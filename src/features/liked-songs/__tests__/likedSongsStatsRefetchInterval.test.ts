import { describe, expect, it } from "vite-plus/test";
import { likedSongsStatsRefetchInterval } from "../hooks/useLikedSongsList";

describe("likedSongsStatsRefetchInterval", () => {
	it("does not poll when enrichment is idle", () => {
		expect(likedSongsStatsRefetchInterval(false, "disconnected")).toBe(false);
	});

	it("polls while enrichment is running and the stream is disconnected", () => {
		expect(likedSongsStatsRefetchInterval(true, "disconnected")).toBe(5_000);
	});

	it("stays quiet while the stream is connected", () => {
		expect(likedSongsStatsRefetchInterval(true, "connected")).toBe(false);
	});
});
