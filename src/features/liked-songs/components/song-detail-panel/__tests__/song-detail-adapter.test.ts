/**
 * Adapter tests — task 12.3.
 *
 * Verifies that an instrumental-shaped analysis row produces a non-null
 * instrumentalRead (not read = null), and that a lyrical row keeps the existing
 * lyrical path intact. Both schemas are parsed in parallel; exactly one wins.
 */

import { describe, expect, it } from "vitest";
import type { AnalysisContent } from "@/lib/domains/enrichment/content-analysis/analysis-content";
import type { LikedSong } from "../../../types";
import { likedSongToSongDetail } from "../song-detail-adapter";

// Minimal LikedSong fixture factory. Only the fields the adapter actually reads
// need to be present; we skip unrelated join columns with a cast.
function makeSong(
	overrides: Partial<{
		analysis: LikedSong["analysis"];
		displayState: LikedSong["displayState"];
		contentFetchStatus: LikedSong["contentFetchStatus"];
	}> = {},
): LikedSong {
	return {
		liked_at: "2024-01-01T00:00:00Z",
		matching_status: null,
		track: {
			id: "track-1",
			spotify_track_id: "spotify-1",
			name: "Veridis Quo",
			artist: "Daft Punk",
			artist_id: null,
			artist_image_url: null,
			album: "Discovery",
			image_url: null,
			genres: ["electronic", "house"],
			audio_features: null,
		},
		analysis: overrides.analysis ?? null,
		displayState: overrides.displayState ?? "analyzed",
		contentFetchStatus: overrides.contentFetchStatus ?? null,
	};
}

// Cast through AnalysisContent — the adapter's safeParse calls handle the
// discriminating at runtime; the stored JSON is untyped in practice.
const INSTRUMENTAL_ANALYSIS_BLOB = {
	headline: "The texture of arriving nowhere in particular",
	compound_mood: "Ambient Drift",
	sonic_texture: "Deep Electronic",
	mood_description:
		"A slow unwinding, like watching city lights from a moving train at 3am. It doesn't want to take you anywhere specific — it wants you to stop needing to go.",
	// The adapter ignores this extra key (Zod strips it), matching production storage.
	audio_features: { tempo: 96, energy: 0.38, valence: 0.25 },
} as unknown as AnalysisContent;

const LYRICAL_ANALYSIS_BLOB = {
	image: "the long way home, alone this time",
	lens: "license as eulogy",
	tension: "Aching Disbelief",
	take: "She passed the test she swore she would pass for him.",
	contradiction: "She got everything she wanted. She got it alone.",
	arc: [
		{ label: "Verse", mood: "Hushed", scene: "Just her voice." },
		{ label: "Chorus", mood: "Cathartic", scene: "The dam breaks." },
	],
	lines: [{ line: "I got my driver's license like I told you I would" }],
	texture: "A ballad that grows a spine.",
} as unknown as AnalysisContent;

describe("likedSongToSongDetail — instrumental path", () => {
	it("yields a non-null instrumentalRead when the stored blob matches SongAnalysisInstrumentalSchema", () => {
		const song = makeSong({
			analysis: {
				id: "analysis-1",
				track_id: "track-1",
				analysis: INSTRUMENTAL_ANALYSIS_BLOB,
				model_name: "gemini-2.0-flash",
				version: 1,
				created_at: null,
			},
		});

		const detail = likedSongToSongDetail(song, "blue");

		expect(detail.instrumentalRead).not.toBeNull();
		expect(detail.instrumentalRead?.headline).toBe(
			"The texture of arriving nowhere in particular",
		);
		expect(detail.instrumentalRead?.compound_mood).toBe("Ambient Drift");
		expect(detail.instrumentalRead?.sonic_texture).toBe("Deep Electronic");
		expect(detail.instrumentalRead?.mood_description).toContain(
			"slow unwinding",
		);
	});

	it("leaves read null when the stored blob is instrumental-shaped (not lyrical)", () => {
		const song = makeSong({
			analysis: {
				id: "analysis-2",
				track_id: "track-1",
				analysis: INSTRUMENTAL_ANALYSIS_BLOB,
				model_name: "gemini-2.0-flash",
				version: 1,
				created_at: null,
			},
		});

		const detail = likedSongToSongDetail(song, "blue");

		// Lyrical path must stay null — no cross-contamination.
		expect(detail.read).toBeNull();
	});
});

describe("likedSongToSongDetail — lyrical path (existing behaviour unchanged)", () => {
	it("yields a non-null read and null instrumentalRead for a lyrical blob", () => {
		const song = makeSong({
			analysis: {
				id: "analysis-3",
				track_id: "track-1",
				analysis: LYRICAL_ANALYSIS_BLOB,
				model_name: "gemini-2.0-flash",
				version: 17,
				created_at: null,
			},
		});

		const detail = likedSongToSongDetail(song, "rose");

		expect(detail.read).not.toBeNull();
		expect(detail.read?.image).toBe("the long way home, alone this time");
		expect(detail.instrumentalRead).toBeNull();
	});
});

describe("likedSongToSongDetail — no analysis row", () => {
	it("leaves both read and instrumentalRead null when there is no analysis", () => {
		const song = makeSong({ analysis: null });
		const detail = likedSongToSongDetail(song, "green");

		expect(detail.read).toBeNull();
		expect(detail.instrumentalRead).toBeNull();
	});
});

// §13.3 — contentFetchStatus threading (resolved-unknown presentation)
describe("likedSongToSongDetail — contentFetchStatus threading", () => {
	it("threads not_found fetch status through to SongDetail", () => {
		const song = makeSong({
			analysis: null,
			displayState: "pending",
			contentFetchStatus: "not_found",
		});

		const detail = likedSongToSongDetail(song, "green");

		expect(detail.contentFetchStatus).toBe("not_found");
		expect(detail.read).toBeNull();
		expect(detail.instrumentalRead).toBeNull();
	});

	it("threads lyrics fetch status through to SongDetail", () => {
		const song = makeSong({ contentFetchStatus: "lyrics" });
		const detail = likedSongToSongDetail(song, "blue");

		expect(detail.contentFetchStatus).toBe("lyrics");
	});

	it("threads instrumental fetch status through to SongDetail", () => {
		const song = makeSong({ contentFetchStatus: "instrumental" });
		const detail = likedSongToSongDetail(song, "rose");

		expect(detail.contentFetchStatus).toBe("instrumental");
	});

	it("passes null when no fetch has been recorded", () => {
		const song = makeSong({ contentFetchStatus: null });
		const detail = likedSongToSongDetail(song, "green");

		expect(detail.contentFetchStatus).toBeNull();
	});
});
