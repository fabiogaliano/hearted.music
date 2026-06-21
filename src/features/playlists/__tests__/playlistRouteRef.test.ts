import { describe, expect, it } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import {
	buildPlaylistRouteRef,
	resolvePlaylistIdFromRouteRef,
} from "../playlistRouteRef";

function createPlaylist(overrides: Partial<Playlist>): Playlist {
	return {
		id: "cc5695a5-2241-408e-aeb3-5c5a098d1e33",
		account_id: "acct-1",
		spotify_id: "spotify-1",
		name: "Ambient Morning",
		description: null,
		match_intent: null,
		match_filters: { version: 1 },
		snapshot_id: null,
		is_public: true,
		song_count: 42,
		is_target: false,
		image_url: null,
		genre_pills: [],
		created_at: "2026-05-07T00:00:00Z",
		updated_at: "2026-05-07T00:00:00Z",
		...overrides,
	};
}

describe("playlistRouteRef", () => {
	it("builds a readable slug plus short id prefix", () => {
		const playlist = createPlaylist({});

		expect(buildPlaylistRouteRef(playlist)).toBe(
			"ambient-morning--cc5695a52241",
		);
	});

	it("resolves a route ref back to the matching playlist id", () => {
		const playlist = createPlaylist({});

		expect(
			resolvePlaylistIdFromRouteRef(
				[playlist],
				"ambient-morning--cc5695a52241",
			),
		).toBe(playlist.id);
	});

	it("uses the slug to break ties when multiple playlists share the same id prefix", () => {
		const first = createPlaylist({
			id: "cc5695a5-2241-408e-aeb3-5c5a098d1e33",
			name: "Ambient Morning",
		});
		const second = createPlaylist({
			id: "cc5695a5-2241-4f4a-aeb3-5c5a098d9f90",
			name: "Driving At Night",
			spotify_id: "spotify-2",
		});

		expect(
			resolvePlaylistIdFromRouteRef(
				[first, second],
				"driving-at-night--cc5695a52241",
			),
		).toBe(second.id);
	});

	it("trims trailing hyphens introduced by slug truncation", () => {
		const playlist = createPlaylist({
			id: "36536617-ed4f-408e-aeb3-5c5a098d1e33",
			name: "Dubolt Mix Kendrick Lamar Ross From Friends Kaytranada Totally Enormous Extinct Dinosaurs",
		});

		expect(buildPlaylistRouteRef(playlist)).toBe(
			"dubolt-mix-kendrick-lamar-ross-from-friends-kaytranada-totally-enormous-extinct--36536617ed4f",
		);
	});

	it("resolves legacy refs with an extra hyphen before the id prefix", () => {
		const playlist = createPlaylist({
			id: "36536617-ed4f-408e-aeb3-5c5a098d1e33",
			name: "Dubolt Mix Kendrick Lamar Ross From Friends Kaytranada Totally Enormous Extinct Dinosaurs",
		});

		expect(
			resolvePlaylistIdFromRouteRef(
				[playlist],
				"dubolt-mix-kendrick-lamar-ross-from-friends-kaytranada-totally-enormous-extinct---36536617ed4f",
			),
		).toBe(playlist.id);
	});

	it("returns null for invalid refs", () => {
		const playlist = createPlaylist({});

		expect(resolvePlaylistIdFromRouteRef([playlist], "ambient-morning")).toBe(
			null,
		);
	});

	it("returns null when the id prefix matches no playlist", () => {
		const playlist = createPlaylist({});

		expect(
			resolvePlaylistIdFromRouteRef(
				[playlist],
				"ambient-morning--ffffffffffff",
			),
		).toBe(null);
	});

	it("returns null when the prefix is ambiguous and the slug matches none", () => {
		const first = createPlaylist({
			id: "cc5695a5-2241-408e-aeb3-5c5a098d1e33",
			name: "Ambient Morning",
		});
		const second = createPlaylist({
			id: "cc5695a5-2241-4f4a-aeb3-5c5a098d9f90",
			name: "Driving At Night",
			spotify_id: "spotify-2",
		});

		expect(
			resolvePlaylistIdFromRouteRef(
				[first, second],
				"unrelated-name--cc5695a52241",
			),
		).toBe(null);
	});
});
