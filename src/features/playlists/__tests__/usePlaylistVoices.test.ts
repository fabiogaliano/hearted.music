import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { computeIntentWeight } from "@/lib/domains/taste/playlist-profiling/calculations";
import {
	computePlaylistVoices,
	usePlaylistVoices,
} from "../hooks/usePlaylistVoices";

function createPlaylist(overrides: Partial<Playlist>): Playlist {
	return {
		id: "cc5695a5-2241-408e-aeb3-5c5a098d1e33",
		account_id: "acct-1",
		spotify_id: "spotify-1",
		name: "Test Playlist",
		description: null,
		snapshot_id: null,
		is_public: true,
		song_count: 0,
		is_target: false,
		image_url: null,
		genre_pills: [],
		created_at: "2026-05-07T00:00:00Z",
		updated_at: "2026-05-07T00:00:00Z",
		...overrides,
	};
}

describe("computePlaylistVoices", () => {
	it("returns cold-start when there are no songs, regardless of description", () => {
		const noDesc = computePlaylistVoices({
			songCount: 0,
			hasDescription: false,
		});
		const withDesc = computePlaylistVoices({
			songCount: 0,
			hasDescription: true,
		});

		expect(noDesc.state).toBe("cold-start");
		expect(noDesc.songs).toBe(0);
		expect(noDesc.vibe).toBe(1);
		expect(withDesc.state).toBe("cold-start");
		expect(withDesc.vibe).toBe(1);
	});

	it("hits the description-present floor (0.30) once the playlist matures past 30 songs", () => {
		const weights = computePlaylistVoices({
			songCount: 50,
			hasDescription: true,
		});
		expect(weights.vibe).toBeCloseTo(0.3, 5);
		expect(weights.songs).toBeCloseTo(0.7, 5);
		expect(weights.state).toBe("balanced");
	});

	it("hits the name-only floor (0.15) once the playlist matures past 30 songs", () => {
		const weights = computePlaylistVoices({
			songCount: 50,
			hasDescription: false,
		});
		expect(weights.vibe).toBeCloseTo(0.15, 5);
		expect(weights.state).toBe("songs-lead");
	});

	it("classifies vibe-leads at low song counts with a description", () => {
		const weights = computePlaylistVoices({
			songCount: 1,
			hasDescription: true,
		});
		expect(weights.vibe).toBeGreaterThan(0.45);
		expect(weights.state).toBe("vibe-leads");
	});

	it("classifies songs-lead at low song counts without a description, since the curve sits on the lower floor", () => {
		const weights = computePlaylistVoices({
			songCount: 20,
			hasDescription: false,
		});
		expect(weights.vibe).toBeLessThan(0.25);
		expect(weights.state).toBe("songs-lead");
	});

	it("derives hasDescription from a Playlist by trimming whitespace-only descriptions", () => {
		// song_count is non-zero so hasDescription actually influences the curve;
		// at 0 songs the cold-start branch ignores it.
		const whitespace = renderHook(() =>
			usePlaylistVoices(createPlaylist({ song_count: 50, description: "   " })),
		).result.current;
		const real = renderHook(() =>
			usePlaylistVoices(
				createPlaylist({ song_count: 50, description: "A real one." }),
			),
		).result.current;
		const nullDesc = renderHook(() =>
			usePlaylistVoices(createPlaylist({ song_count: 50, description: null })),
		).result.current;

		expect(whitespace.hasDescription).toBe(false);
		expect(real.hasDescription).toBe(true);
		expect(nullDesc.hasDescription).toBe(false);

		// Whitespace-only must land on the name-only floor, identical to null —
		// not the description-present floor.
		expect(whitespace.vibe).toBeCloseTo(nullDesc.vibe, 10);
		expect(whitespace.vibe).not.toBeCloseTo(real.vibe, 5);
	});

	it("songs + vibe always sum to 1", () => {
		for (const songCount of [0, 1, 5, 15, 30, 100]) {
			for (const hasDescription of [true, false]) {
				const weights = computePlaylistVoices({ songCount, hasDescription });
				expect(weights.songs + weights.vibe).toBeCloseTo(1, 5);
			}
		}
	});

	it("vibe weight monotonically decreases as song count grows (with description present)", () => {
		const counts = [1, 5, 10, 20, 30];
		const vibes = counts.map(
			(c) => computePlaylistVoices({ songCount: c, hasDescription: true }).vibe,
		);
		for (let i = 1; i < vibes.length; i++) {
			expect(vibes[i]).toBeLessThanOrEqual(vibes[i - 1] + 1e-9);
		}
	});

	// The hook inlines the matcher's intent-weight formula to keep the client
	// bundle free of server-only domain code. This sync test imports the live
	// computeIntentWeight from the matcher and asserts both sides agree across
	// a representative grid — if anyone tunes a constant on either side and
	// forgets to mirror it, this test fails loudly.
	it("matches the matcher's computeIntentWeight across a representative grid", () => {
		const songCounts = [1, 3, 5, 10, 15, 20, 25, 30, 60];
		const descriptionFlags = [true, false];
		for (const songCount of songCounts) {
			for (const hasDescription of descriptionFlags) {
				const live = computeIntentWeight(songCount, hasDescription);
				const hookVibe = computePlaylistVoices({
					songCount,
					hasDescription,
				}).vibe;
				expect(hookVibe).toBeCloseTo(live, 10);
			}
		}
	});
});
