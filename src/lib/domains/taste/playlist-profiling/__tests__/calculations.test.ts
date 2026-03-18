/**
 * Tests for profiling calculation functions.
 */

import { describe, expect, it } from "vitest";
import type { Song } from "@/lib/domains/library/songs/queries";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import { hashPlaylistProfile } from "@/lib/domains/enrichment/embeddings/hashing";
import {
	blendEmbeddings,
	calculateAudioCentroid,
	calculateCentroid,
	computeGenreDistribution,
	computeIntentWeight,
} from "../calculations";

// ============================================================================
// Test Helpers
// ============================================================================

function createAudioFeature(partial: Partial<AudioFeature> = {}): AudioFeature {
	return {
		id: "test-id",
		song_id: partial.song_id ?? "test-song",
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		energy: partial.energy ?? null,
		valence: partial.valence ?? null,
		danceability: partial.danceability ?? null,
		acousticness: partial.acousticness ?? null,
		instrumentalness: partial.instrumentalness ?? null,
		speechiness: partial.speechiness ?? null,
		liveness: partial.liveness ?? null,
		tempo: partial.tempo ?? null,
		loudness: partial.loudness ?? null,
		key: null,
		mode: null,
		time_signature: null,
	};
}

function createSong(partial: Partial<Song> = {}): Song {
	return {
		id: partial.id ?? "test-song-id",
		spotify_id: partial.spotify_id ?? "test-spotify-id",
		name: partial.name ?? "Test Song",
		artists: partial.artists ?? ["Test Artist"],
		artist_ids: partial.artist_ids ?? ["test-artist-id"],
		genres: partial.genres ?? [],
		album_id: partial.album_id ?? null,
		album_name: partial.album_name ?? null,
		image_url: partial.image_url ?? null,
		isrc: partial.isrc ?? null,
		duration_ms: partial.duration_ms ?? null,
		popularity: partial.popularity ?? null,
		preview_url: partial.preview_url ?? null,
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
	};
}

// ============================================================================
// calculateCentroid
// ============================================================================

describe("calculateCentroid", () => {
	it("returns empty array for empty vectors", () => {
		const centroid = calculateCentroid([]);
		expect(centroid).toEqual([]);
	});

	it("returns same vector for single vector", () => {
		const centroid = calculateCentroid([[1, 2, 3]]);
		expect(centroid).toEqual([1, 2, 3]);
	});

	it("calculates correct mean for multiple vectors", () => {
		const vectors = [
			[1, 2, 3],
			[3, 4, 5],
			[5, 6, 7],
		];
		const centroid = calculateCentroid(vectors);
		// Mean: [(1+3+5)/3, (2+4+6)/3, (3+5+7)/3] = [3, 4, 5]
		expect(centroid).toEqual([3, 4, 5]);
	});

	it("handles negative values correctly", () => {
		const vectors = [
			[-1, -2, -3],
			[1, 2, 3],
		];
		const centroid = calculateCentroid(vectors);
		// Mean: [0, 0, 0]
		expect(centroid).toEqual([0, 0, 0]);
	});

	it("handles decimal values correctly", () => {
		const vectors = [
			[0.1, 0.2, 0.3],
			[0.4, 0.5, 0.6],
		];
		const centroid = calculateCentroid(vectors);
		// Mean: [0.25, 0.35, 0.45]
		expect(centroid[0]).toBeCloseTo(0.25);
		expect(centroid[1]).toBeCloseTo(0.35);
		expect(centroid[2]).toBeCloseTo(0.45);
	});
});

// ============================================================================
// calculateAudioCentroid
// ============================================================================

describe("calculateAudioCentroid", () => {
	it("returns empty object for empty features", () => {
		const centroid = calculateAudioCentroid([]);
		expect(centroid).toEqual({});
	});

	it("filters NaN values", () => {
		const features: AudioFeature[] = [
			createAudioFeature({
				song_id: "1",
				energy: Number.NaN,
				valence: 0.5,
			}),
			createAudioFeature({
				song_id: "2",
				energy: 0.8,
				valence: 0.6,
			}),
		];
		const centroid = calculateAudioCentroid(features);
		// Energy: NaN filtered, only 0.8 counted
		expect(centroid.energy).toBe(0.8);
		// Valence: both counted, mean = 0.55
		expect(centroid.valence).toBeCloseTo(0.55);
	});

	it("filters null values", () => {
		const features: AudioFeature[] = [
			createAudioFeature({
				song_id: "1",
				energy: 0.8,
				valence: null,
				danceability: 0,
				acousticness: 0,
				instrumentalness: 0,
				speechiness: 0,
				liveness: 0,
				tempo: 0,
				loudness: 0,
			}),
			createAudioFeature({
				song_id: "2",
				energy: 0.6,
				valence: 0.5,
				danceability: 0,
				acousticness: 0,
				instrumentalness: 0,
				speechiness: 0,
				liveness: 0,
				tempo: 0,
				loudness: 0,
			}),
		];
		const centroid = calculateAudioCentroid(features);
		// Valence: null filtered, only 0.5 counted
		expect(centroid.valence).toBe(0.5);
		// Energy: both counted, mean = 0.7
		expect(centroid.energy).toBeCloseTo(0.7);
	});

	it("calculates correct averages per field", () => {
		const features: AudioFeature[] = [
			createAudioFeature({
				song_id: "1",
				energy: 0.8,
				valence: 0.6,
				danceability: 0.7,
				acousticness: 0.2,
				instrumentalness: 0.1,
				speechiness: 0.05,
				liveness: 0.15,
				tempo: 120,
				loudness: -5,
			}),
			createAudioFeature({
				song_id: "2",
				energy: 0.6,
				valence: 0.4,
				danceability: 0.5,
				acousticness: 0.4,
				instrumentalness: 0.2,
				speechiness: 0.15,
				liveness: 0.25,
				tempo: 140,
				loudness: -8,
			}),
		];
		const centroid = calculateAudioCentroid(features);
		expect(centroid.energy).toBeCloseTo(0.7);
		expect(centroid.valence).toBeCloseTo(0.5);
		expect(centroid.danceability).toBeCloseTo(0.6);
		expect(centroid.acousticness).toBeCloseTo(0.3);
		expect(centroid.instrumentalness).toBeCloseTo(0.15);
		expect(centroid.speechiness).toBeCloseTo(0.1);
		expect(centroid.liveness).toBeCloseTo(0.2);
		expect(centroid.tempo).toBeCloseTo(130);
		expect(centroid.loudness).toBeCloseTo(-6.5);
	});

	it("handles mixed present/missing features", () => {
		const features: AudioFeature[] = [
			createAudioFeature({
				song_id: "1",
				energy: 0.8,
				valence: null,
				danceability: 0,
				acousticness: 0,
				instrumentalness: 0,
				speechiness: 0,
				liveness: 0,
				tempo: 0,
				loudness: 0,
			}),
			createAudioFeature({
				song_id: "2",
				energy: null,
				valence: 0.5,
				danceability: 0,
				acousticness: 0,
				instrumentalness: 0,
				speechiness: 0,
				liveness: 0,
				tempo: 0,
				loudness: 0,
			}),
		];
		const centroid = calculateAudioCentroid(features);
		// Energy: only song 1
		expect(centroid.energy).toBe(0.8);
		// Valence: only song 2
		expect(centroid.valence).toBe(0.5);
	});

	it("omits fields with no valid values", () => {
		const features: AudioFeature[] = [
			createAudioFeature({
				song_id: "1",
				energy: Number.NaN,
				valence: null,
				danceability: 0,
				acousticness: 0,
				instrumentalness: 0,
				speechiness: 0,
				liveness: 0,
				tempo: 0,
				loudness: 0,
			}),
		];
		const centroid = calculateAudioCentroid(features);
		// Energy and valence should not be in centroid
		expect(centroid.energy).toBeUndefined();
		expect(centroid.valence).toBeUndefined();
	});
});

// ============================================================================
// computeGenreDistribution
// ============================================================================

describe("computeGenreDistribution", () => {
	it("returns empty object for empty songs", () => {
		const distribution = computeGenreDistribution([]);
		expect(distribution).toEqual({});
	});

	it("returns empty object for songs without genres", () => {
		const songs: Song[] = [
			createSong({
				id: "1",
				name: "Song 1",
				artists: ["Artist 1"],
				spotify_id: "spotify1",
				genres: [],
			}),
			createSong({
				id: "2",
				name: "Song 2",
				artists: ["Artist 2"],
				spotify_id: "spotify2",
				genres: [],
			}),
		];
		const distribution = computeGenreDistribution(songs);
		expect(distribution).toEqual({});
	});

	it("accumulates genre counts correctly", () => {
		const songs: Song[] = [
			createSong({
				id: "1",
				name: "Song 1",
				artists: ["Artist 1"],
				spotify_id: "spotify1",
				genres: ["rock", "indie"],
			}),
			createSong({
				id: "2",
				name: "Song 2",
				artists: ["Artist 2"],
				spotify_id: "spotify2",
				genres: ["rock", "alternative"],
			}),
			createSong({
				id: "3",
				name: "Song 3",
				artists: ["Artist 3"],
				spotify_id: "spotify3",
				genres: ["indie"],
			}),
		];
		const distribution = computeGenreDistribution(songs);
		expect(distribution).toEqual({
			rock: 2,
			indie: 2,
			alternative: 1,
		});
	});

	it("handles duplicate genres in same song", () => {
		const songs: Song[] = [
			createSong({
				id: "1",
				name: "Song 1",
				artists: ["Artist 1"],
				spotify_id: "spotify1",
				genres: ["rock", "rock", "indie"],
			}),
		];
		const distribution = computeGenreDistribution(songs);
		// Each occurrence counts
		expect(distribution).toEqual({
			rock: 2,
			indie: 1,
		});
	});

	it("handles mixed songs with and without genres", () => {
		const songs: Song[] = [
			createSong({
				id: "1",
				name: "Song 1",
				artists: ["Artist 1"],
				spotify_id: "spotify1",
				genres: ["rock"],
			}),
			createSong({
				id: "2",
				name: "Song 2",
				artists: ["Artist 2"],
				spotify_id: "spotify2",
				genres: [],
			}),
			createSong({
				id: "3",
				name: "Song 3",
				artists: ["Artist 3"],
				spotify_id: "spotify3",
				genres: ["indie"],
			}),
		];
		const distribution = computeGenreDistribution(songs);
		expect(distribution).toEqual({
			rock: 1,
			indie: 1,
		});
	});
});

// ============================================================================
// blendEmbeddings
// ============================================================================

function l2Norm(vec: number[]): number {
	return Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
}

describe("blendEmbeddings", () => {
	it("returns song centroid when intent is null", () => {
		const result = blendEmbeddings([1, 2, 3], null, 0.5);
		expect(result).toEqual([1, 2, 3]);
	});

	it("returns song centroid when intent is empty", () => {
		const result = blendEmbeddings([1, 2, 3], [], 0.5);
		expect(result).toEqual([1, 2, 3]);
	});

	it("returns intent embedding when song centroid is empty", () => {
		const result = blendEmbeddings([], [1, 2, 3], 0.5);
		expect(result).toEqual([1, 2, 3]);
	});

	it("produces unit-length output", () => {
		const result = blendEmbeddings([1, 0, 0], [0, 1, 0], 0.5);
		expect(l2Norm(result)).toBeCloseTo(1.0);
	});

	it("at weight=0, result equals normalized song centroid direction", () => {
		const songCentroid = [3, 4, 0];
		const intent = [0, 0, 5];
		const result = blendEmbeddings(songCentroid, intent, 0);
		// Should point in direction of [3, 4, 0] normalized = [0.6, 0.8, 0]
		expect(result[0]).toBeCloseTo(0.6);
		expect(result[1]).toBeCloseTo(0.8);
		expect(result[2]).toBeCloseTo(0);
	});

	it("at weight=1, result equals normalized intent direction", () => {
		const songCentroid = [3, 4, 0];
		const intent = [0, 0, 5];
		const result = blendEmbeddings(songCentroid, intent, 1);
		// Should point in direction of [0, 0, 5] normalized = [0, 0, 1]
		expect(result[0]).toBeCloseTo(0);
		expect(result[1]).toBeCloseTo(0);
		expect(result[2]).toBeCloseTo(1);
	});

	it("normalizes inputs so magnitude doesn't bias the blend", () => {
		// Same direction, different magnitudes
		const smallCentroid = [0.1, 0.1, 0];
		const largeCentroid = [10, 10, 0];
		const intent = [0, 0, 1];

		const resultSmall = blendEmbeddings(smallCentroid, intent, 0.5);
		const resultLarge = blendEmbeddings(largeCentroid, intent, 0.5);

		// Both should produce the same blended result (same directions, same weight)
		expect(resultSmall[0]).toBeCloseTo(resultLarge[0]);
		expect(resultSmall[1]).toBeCloseTo(resultLarge[1]);
		expect(resultSmall[2]).toBeCloseTo(resultLarge[2]);
	});

	it("blends orthogonal vectors at weight=0.5 equally", () => {
		const result = blendEmbeddings([1, 0], [0, 1], 0.5);
		// Both normalized to unit → 50/50 → [0.5, 0.5] → normalized
		const expected = 1 / Math.sqrt(2);
		expect(result[0]).toBeCloseTo(expected);
		expect(result[1]).toBeCloseTo(expected);
	});
});

// ============================================================================
// computeIntentWeight
// ============================================================================

describe("computeIntentWeight", () => {
	it("enforces name-only floor at 0.15", () => {
		expect(computeIntentWeight(100, false)).toBeCloseTo(0.15);
		expect(computeIntentWeight(50, false)).toBeCloseTo(0.15);
	});

	it("enforces description floor at 0.30", () => {
		expect(computeIntentWeight(100, true)).toBeCloseTo(0.3);
		expect(computeIntentWeight(50, true)).toBeCloseTo(0.3);
	});

	it("returns higher weight for fewer songs", () => {
		const w1 = computeIntentWeight(1, true);
		const w10 = computeIntentWeight(10, true);
		const w25 = computeIntentWeight(25, true);
		expect(w1).toBeGreaterThan(w10);
		expect(w10).toBeGreaterThan(w25);
	});

	it("description presence boosts weight", () => {
		const withDesc = computeIntentWeight(5, true);
		const nameOnly = computeIntentWeight(5, false);
		expect(withDesc).toBeGreaterThan(nameOnly);
	});

	it("never exceeds 1.0", () => {
		expect(computeIntentWeight(0, true)).toBeLessThanOrEqual(1.0);
	});

	it("hits floor at maturity threshold (30 songs)", () => {
		const w30desc = computeIntentWeight(30, true);
		expect(w30desc).toBeCloseTo(0.3);

		const w30name = computeIntentWeight(30, false);
		expect(w30name).toBeCloseTo(0.15);
	});

	it("decays smoothly between 0 and 30 songs", () => {
		const weights = Array.from({ length: 31 }, (_, i) =>
			computeIntentWeight(i, true),
		);
		// Each weight should be >= the next (monotonically non-increasing)
		for (let i = 0; i < weights.length - 1; i++) {
			expect(weights[i]).toBeGreaterThanOrEqual(weights[i + 1] - 0.001);
		}
	});
});

// ============================================================================
// hashPlaylistProfile — intent text in content hash
// ============================================================================

describe("hashPlaylistProfile intent text", () => {
	const baseSongIds = ["song-1", "song-2"];
	const baseCentroid = [0.1, 0.2, 0.3];

	it("same songs + different description → different hash", async () => {
		const hash1 = await hashPlaylistProfile({
			playlistId: "pl-1",
			songIds: baseSongIds,
			descriptionText: "crying in the car",
			embeddingCentroid: baseCentroid,
		});
		const hash2 = await hashPlaylistProfile({
			playlistId: "pl-1",
			songIds: baseSongIds,
			descriptionText: "revenge era",
			embeddingCentroid: baseCentroid,
		});
		expect(hash1).not.toBe(hash2);
	});

	it("same songs + no description vs with description → different hash", async () => {
		const hashNoDesc = await hashPlaylistProfile({
			playlistId: "pl-1",
			songIds: baseSongIds,
			embeddingCentroid: baseCentroid,
		});
		const hashWithDesc = await hashPlaylistProfile({
			playlistId: "pl-1",
			songIds: baseSongIds,
			descriptionText: "sunday softness",
			embeddingCentroid: baseCentroid,
		});
		expect(hashNoDesc).not.toBe(hashWithDesc);
	});

	it("same description → same hash (deterministic)", async () => {
		const hash1 = await hashPlaylistProfile({
			playlistId: "pl-1",
			songIds: baseSongIds,
			descriptionText: "crying in the car",
			embeddingCentroid: baseCentroid,
		});
		const hash2 = await hashPlaylistProfile({
			playlistId: "pl-1",
			songIds: baseSongIds,
			descriptionText: "crying in the car",
			embeddingCentroid: baseCentroid,
		});
		expect(hash1).toBe(hash2);
	});
});
