import { describe, expect, it } from "vitest";
import {
	MAX_LIKED_SONGS,
	SyncPayloadSchema,
} from "@/lib/workflows/spotify-sync/payload-schema";

function aTrack(id: string) {
	return {
		added_at: "2026-01-01T00:00:00Z",
		track: {
			id,
			name: `t-${id}`,
			artists: [{ id: `a-${id}`, name: "A" }],
			album: { id: `al-${id}`, name: "Al", images: [] },
			duration_ms: 1000,
			uri: `spotify:track:${id}`,
		},
	};
}

describe("SyncPayloadSchema", () => {
	it("accepts a minimal valid payload", () => {
		const result = SyncPayloadSchema.safeParse({
			likedSongs: [aTrack("t1")],
			playlists: [],
		});
		expect(result.success).toBe(true);
	});

	it("accepts an optional userProfile and playlistTracks", () => {
		const result = SyncPayloadSchema.safeParse({
			likedSongs: [],
			playlists: [
				{
					id: "p1",
					name: "P",
					description: null,
					owner: { id: "o1" },
					track_count: null,
					image_url: null,
				},
			],
			playlistTracks: [{ playlistSpotifyId: "p1", tracks: [aTrack("t1")] }],
			userProfile: { spotifyId: "sp1", displayName: "Me" },
		});
		expect(result.success).toBe(true);
	});

	it("rejects a payload whose likedSongs is not an array", () => {
		const result = SyncPayloadSchema.safeParse({
			likedSongs: "nope",
			playlists: [],
		});
		expect(result.success).toBe(false);
	});

	it("rejects a track missing required fields", () => {
		const result = SyncPayloadSchema.safeParse({
			likedSongs: [{ added_at: "x", track: { id: "t1" } }],
			playlists: [],
		});
		expect(result.success).toBe(false);
	});

	it("enforces the liked-songs cap", () => {
		const result = SyncPayloadSchema.safeParse({
			likedSongs: Array.from({ length: MAX_LIKED_SONGS + 1 }, (_, i) =>
				aTrack(`t${i}`),
			),
			playlists: [],
		});
		expect(result.success).toBe(false);
	});
});
