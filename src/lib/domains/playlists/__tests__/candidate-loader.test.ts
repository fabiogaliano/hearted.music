/**
 * Tests for the Phase-1 candidate loader.
 *
 * The loader must include un-entitled, non-analyzed songs that have Phase-1
 * enrichment (genres OR audio features) and must exclude songs with neither.
 * It must NOT call `select_data_enriched_liked_song_ids` (which requires
 * song_analysis + song_embedding) — it queries liked_song + song directly.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPhase1Candidates } from "../candidate-loader";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockLikedSongIs, mockFrom, mockGetAudioFeaturesBatch } = vi.hoisted(
	() => {
		const mockLikedSongIs = vi.fn();
		const mockLikedSongEq = vi.fn(() => ({ is: mockLikedSongIs }));
		const mockLikedSongSelect = vi.fn(() => ({ eq: mockLikedSongEq }));
		const mockFrom = vi.fn(() => ({ select: mockLikedSongSelect }));
		const mockGetAudioFeaturesBatch = vi.fn();

		return {
			mockLikedSongIs,
			mockFrom,
			mockGetAudioFeaturesBatch,
		};
	},
);

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ from: mockFrom }),
}));

vi.mock("@/lib/domains/enrichment/audio-features/queries", () => ({
	getBatch: mockGetAudioFeaturesBatch,
}));

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

function makeSongRow(
	id: string,
	opts: {
		genres?: string[] | null;
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
	};
}

function makeLikedRow(songId: string, song: ReturnType<typeof makeSongRow>) {
	return { song_id: songId, liked_at: "2024-01-01T00:00:00Z", song };
}

function makeAudioFeatureRow(songId: string) {
	return {
		song_id: songId,
		energy: 0.7,
		valence: 0.5,
		danceability: 0.6,
		acousticness: 0.2,
		instrumentalness: 0.1,
		speechiness: 0.05,
		liveness: 0.1,
		tempo: 120,
		loudness: -10,
		key: null,
		mode: null,
		time_signature: null,
	};
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
		const song = makeSongRow(songId, { genres: ["indie rock"] });
		mockLikedSongIs.mockResolvedValue({
			data: [makeLikedRow(songId, song)],
			error: null,
		});
		// No audio features for this song
		mockGetAudioFeaturesBatch.mockResolvedValue(Result.ok(new Map()));

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(1);
		expect(candidates[0].song.id).toBe(songId);
		expect(candidates[0].song.genres).toEqual(["indie rock"]);
		expect(candidates[0].song.audioFeatures).toBeNull();
	});

	it("includes a song that has only audio features (no genres)", async () => {
		const songId = "audio-only";
		const song = makeSongRow(songId, { genres: [] });
		mockLikedSongIs.mockResolvedValue({
			data: [makeLikedRow(songId, song)],
			error: null,
		});
		mockGetAudioFeaturesBatch.mockResolvedValue(
			Result.ok(new Map([[songId, makeAudioFeatureRow(songId)]])),
		);

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(1);
		expect(candidates[0].song.id).toBe(songId);
		expect(candidates[0].song.audioFeatures).not.toBeNull();
	});

	it("excludes a song with no genres AND no audio features", async () => {
		const songId = "unenriched";
		const song = makeSongRow(songId, { genres: [] });
		mockLikedSongIs.mockResolvedValue({
			data: [makeLikedRow(songId, song)],
			error: null,
		});
		// No audio features
		mockGetAudioFeaturesBatch.mockResolvedValue(Result.ok(new Map()));

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(0);
	});

	it("includes a song that has both genres AND audio features", async () => {
		const songId = "both";
		const song = makeSongRow(songId, { genres: ["pop"] });
		mockLikedSongIs.mockResolvedValue({
			data: [makeLikedRow(songId, song)],
			error: null,
		});
		mockGetAudioFeaturesBatch.mockResolvedValue(
			Result.ok(new Map([[songId, makeAudioFeatureRow(songId)]])),
		);

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(1);
		expect(candidates[0].song.audioFeatures).not.toBeNull();
		expect(candidates[0].song.genres).toEqual(["pop"]);
	});

	it("does NOT call select_data_enriched_liked_song_ids (the analysis-gated RPC)", async () => {
		// The loader must query liked_song directly, not via the RPC that requires
		// song_analysis + song_embedding.
		mockLikedSongIs.mockResolvedValue({ data: [], error: null });
		mockGetAudioFeaturesBatch.mockResolvedValue(Result.ok(new Map()));

		await loadPhase1Candidates("any-account");

		// Verify the query hits liked_song, not song_analysis or song_embedding tables.
		expect(mockFrom).toHaveBeenCalledWith("liked_song");
		expect(mockFrom).not.toHaveBeenCalledWith("song_analysis");
		expect(mockFrom).not.toHaveBeenCalledWith("song_embedding");
	});

	it("returns empty array when account has no liked songs", async () => {
		mockLikedSongIs.mockResolvedValue({ data: [], error: null });
		mockGetAudioFeaturesBatch.mockResolvedValue(Result.ok(new Map()));

		const candidates = await loadPhase1Candidates("any-account");

		expect(candidates).toHaveLength(0);
	});

	it("populates filterMeta correctly from liked_song and song data", async () => {
		const songId = "meta-test";
		const song = {
			...makeSongRow(songId, { genres: ["rock"] }),
			language: "pt",
			language_secondary: "en",
			vocal_gender: "female",
			release_year: 2010,
		};
		const liked_at = "2023-06-15T00:00:00Z";
		mockLikedSongIs.mockResolvedValue({
			data: [{ song_id: songId, liked_at, song }],
			error: null,
		});
		mockGetAudioFeaturesBatch.mockResolvedValue(Result.ok(new Map()));

		const [candidate] = await loadPhase1Candidates("any-account");

		expect(candidate.filterMeta.language).toBe("pt");
		expect(candidate.filterMeta.languageSecondary).toBe("en");
		expect(candidate.filterMeta.vocalGender).toBe("female");
		expect(candidate.filterMeta.releaseYear).toBe(2010);
		expect(candidate.filterMeta.likedAt).toBe(new Date(liked_at).getTime());
	});
});
