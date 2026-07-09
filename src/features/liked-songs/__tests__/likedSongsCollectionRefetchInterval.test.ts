import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { LikedSongsPageResult } from "@/lib/server/liked-songs.functions";
import { likedSongsCollectionRefetchInterval } from "../hooks/useLikedSongsCollection";
import type { LikedSong } from "../types";

function createSong(
	id: string,
	displayState: LikedSong["displayState"],
): LikedSong {
	return {
		liked_at: "2026-03-30T00:00:00Z",
		matching_status: null,
		displayState,
		analysis: null,
		track: {
			id,
			spotify_track_id: `spotify-${id}`,
			name: "Song",
			artist: "Artist",
			artist_id: null,
			artist_image_url: null,
			album: null,
			image_url: null,
			genres: [],
			audio_features: null,
		},
	};
}

function infiniteData(
	pages: LikedSong[][],
): InfiniteData<LikedSongsPageResult> {
	return {
		pages: pages.map((songs) => ({ songs, nextCursor: null })),
		pageParams: pages.map(() => undefined),
	};
}

describe("likedSongsCollectionRefetchInterval", () => {
	it("does not poll before any data has loaded", () => {
		expect(likedSongsCollectionRefetchInterval(undefined, "disconnected")).toBe(
			false,
		);
	});

	it("does not poll once every loaded row is settled", () => {
		const data = infiniteData([
			[
				createSong("a", "analyzed"),
				createSong("b", "failed"),
				createSong("c", "locked"),
			],
		]);
		expect(likedSongsCollectionRefetchInterval(data, "disconnected")).toBe(
			false,
		);
	});

	it("polls at ~5s while a loaded row is still pending", () => {
		const data = infiniteData([
			[createSong("a", "analyzed"), createSong("b", "pending")],
		]);
		expect(likedSongsCollectionRefetchInterval(data, "disconnected")).toBe(
			5_000,
		);
	});

	it("polls while a loaded row is still analyzing", () => {
		const data = infiniteData([[createSong("a", "analyzing")]]);
		expect(likedSongsCollectionRefetchInterval(data, "disconnected")).toBe(
			5_000,
		);
	});

	it("polls when the unsettled row is on a later loaded page", () => {
		const data = infiniteData([
			[createSong("a", "analyzed")],
			[createSong("b", "analyzed"), createSong("c", "pending")],
		]);
		expect(likedSongsCollectionRefetchInterval(data, "disconnected")).toBe(
			5_000,
		);
	});

	it("stays quiet while the stream is connected, even with unsettled rows", () => {
		const data = infiniteData([[createSong("a", "pending")]]);
		expect(likedSongsCollectionRefetchInterval(data, "connected")).toBe(false);
	});
});
