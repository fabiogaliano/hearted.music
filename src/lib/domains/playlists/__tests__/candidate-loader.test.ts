/**
 * Tests for the Phase-1 candidate loader.
 *
 * The loader must include un-entitled, non-analyzed songs that have Phase-1
 * enrichment (genres OR audio features) and must exclude songs with neither.
 * It must NOT call `select_data_enriched_liked_song_ids` (which requires
 * song_analysis + song_embedding) — it queries liked_song + song directly, with
 * the audio feature embedded through the FK (no DB-derived `.in(...)` re-query).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPhase1Candidates } from "../candidate-loader";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockLikedSongLimit, mockLikedSongOrder, mockFrom } = vi.hoisted(() => {
	// Chain terminates at .limit(): select → eq → is → order → limit.
	const mockLikedSongLimit = vi.fn();
	const mockLikedSongOrder = vi.fn(() => ({ limit: mockLikedSongLimit }));
	const mockLikedSongIs = vi.fn(() => ({ order: mockLikedSongOrder }));
	const mockLikedSongEq = vi.fn(() => ({ is: mockLikedSongIs }));
	const mockLikedSongSelect = vi.fn(() => ({ eq: mockLikedSongEq }));
	const mockFrom = vi.fn(() => ({ select: mockLikedSongSelect }));

	return {
		mockLikedSongLimit,
		mockLikedSongOrder,
		mockFrom,
	};
});

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ from: mockFrom }),
}));

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

/** The embedded one-to-one song_audio_feature object, or null when absent. */
function makeEmbeddedAudioFeature() {
	return {
		energy: 0.7,
		valence: 0.5,
		danceability: 0.6,
		acousticness: 0.2,
		instrumentalness: 0.1,
		speechiness: 0.05,
		liveness: 0.1,
		tempo: 120,
		loudness: -10,
	};
}

function makeSongRow(
	id: string,
	opts: {
		genres?: string[] | null;
		audio?: ReturnType<typeof makeEmbeddedAudioFeature> | null;
	} = {},
) {
	return {
		id,
		spotify_id: `sp-${id}`,
		name: `Song ${id}`,
		artists: ["Artist"],
		genres: opts.genres ?? ["pop"],
		image_url: null,
		duration_ms: 180000,
		language: "en",
		language_secondary: null,
		vocal_gender: null,
		release_year: 2022,
		album_name: "Album",
		song_audio_feature: opts.audio ?? null,
	};
}

function makeLikedRow(songId: string, song: object) {
	return { song_id: songId, liked_at: "2024-01-01T00:00:00Z", song };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadPhase1Candidates", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("includes an un-entitled, non-analyzed song that has genres (Phase-1 enriched)", async () => {
		// This song has genres but no song_analysis / song_embedding rows —
		// it is a free-tier song with only Phase-1 enrichment. It must be included.
		const songId = "phase1-genre-only";
		const song = makeSongRow(songId, { genres: ["indie rock"], audio: null });
		mockLikedSongLimit.mockResolvedValue({
			data: [makeLikedRow(songId, song)],
			error: null,
		});

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(1);
		expect(candidates[0].song.id).toBe(songId);
		expect(candidates[0].song.genres).toEqual(["indie rock"]);
		expect(candidates[0].song.audioFeatures).toBeNull();
	});

	it("includes a song that has only audio features (no genres)", async () => {
		const songId = "audio-only";
		const song = makeSongRow(songId, {
			genres: [],
			audio: makeEmbeddedAudioFeature(),
		});
		mockLikedSongLimit.mockResolvedValue({
			data: [makeLikedRow(songId, song)],
			error: null,
		});

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(1);
		expect(candidates[0].song.id).toBe(songId);
		expect(candidates[0].song.audioFeatures).not.toBeNull();
	});

	it("tolerates a to-many audio embed by taking the first row", async () => {
		// Defensive: if PostgREST ever surfaces the embed as an array, the loader
		// must still resolve the audio feature rather than treat it as absent.
		const songId = "audio-array";
		const song = {
			...makeSongRow(songId, { genres: [] }),
			song_audio_feature: [makeEmbeddedAudioFeature()],
		};
		mockLikedSongLimit.mockResolvedValue({
			data: [makeLikedRow(songId, song)],
			error: null,
		});

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(1);
		expect(candidates[0].song.audioFeatures).not.toBeNull();
	});

	it("excludes a song with no genres AND no audio features", async () => {
		const songId = "unenriched";
		const song = makeSongRow(songId, { genres: [], audio: null });
		mockLikedSongLimit.mockResolvedValue({
			data: [makeLikedRow(songId, song)],
			error: null,
		});

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(0);
	});

	it("includes a song that has both genres AND audio features", async () => {
		const songId = "both";
		const song = makeSongRow(songId, {
			genres: ["pop"],
			audio: makeEmbeddedAudioFeature(),
		});
		mockLikedSongLimit.mockResolvedValue({
			data: [makeLikedRow(songId, song)],
			error: null,
		});

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(1);
		expect(candidates[0].song.audioFeatures).not.toBeNull();
		expect(candidates[0].song.genres).toEqual(["pop"]);
	});

	it("does NOT call select_data_enriched_liked_song_ids (the analysis-gated RPC)", async () => {
		// The loader must query liked_song directly, not via the RPC that requires
		// song_analysis + song_embedding.
		mockLikedSongLimit.mockResolvedValue({ data: [], error: null });

		await loadPhase1Candidates("any-account");

		// Verify the query hits liked_song, not song_analysis or song_embedding tables.
		expect(mockFrom).toHaveBeenCalledWith("liked_song");
		expect(mockFrom).not.toHaveBeenCalledWith("song_analysis");
		expect(mockFrom).not.toHaveBeenCalledWith("song_embedding");
	});

	it("returns empty array when account has no liked songs", async () => {
		mockLikedSongLimit.mockResolvedValue({ data: [], error: null });

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(0);
	});

	it("caps the fetch and keeps the most-recently-liked rows", async () => {
		// Bounds the per-preview transfer so a huge library isn't pulled on every
		// debounce cycle; ordering by liked_at desc defines which rows survive the cap.
		mockLikedSongLimit.mockResolvedValue({ data: [], error: null });

		await loadPhase1Candidates("any-account");

		expect(mockLikedSongOrder).toHaveBeenCalledWith("liked_at", {
			ascending: false,
		});
		expect(mockLikedSongLimit).toHaveBeenCalledWith(10_000);
	});

	it("populates filterMeta correctly from liked_song and song data", async () => {
		const songId = "meta-test";
		const song = {
			...makeSongRow(songId, { genres: ["rock"], audio: null }),
			language: "pt",
			language_secondary: "en",
			vocal_gender: "female",
			release_year: 2010,
		};
		const liked_at = "2023-06-15T00:00:00Z";
		mockLikedSongLimit.mockResolvedValue({
			data: [{ song_id: songId, liked_at, song }],
			error: null,
		});

		const [candidate] = await loadPhase1Candidates("any-account");

		expect(candidate.filterMeta.language).toBe("pt");
		expect(candidate.filterMeta.languageSecondary).toBe("en");
		expect(candidate.filterMeta.vocalGender).toBe("female");
		expect(candidate.filterMeta.releaseYear).toBe(2010);
		expect(candidate.filterMeta.likedAt).toBe(new Date(liked_at).getTime());
	});
});
