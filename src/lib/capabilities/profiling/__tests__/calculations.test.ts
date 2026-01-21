/**
 * Tests for profiling calculation functions.
 */

import { describe, expect, it } from "vitest";
import {
	calculateCentroid,
	calculateAudioCentroid,
	computeGenreDistribution,
	computeEmotionDistribution,
} from "../calculations";
import type { Song } from "@/lib/data/song";
import type { SongAnalysis } from "@/lib/data/song-analysis";
import type { AudioFeature } from "@/lib/data/song-audio-feature";

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

function createSongAnalysis(
	partial: Partial<SongAnalysis> = {},
): SongAnalysis {
	return {
		id: partial.id ?? "test-analysis-id",
		song_id: partial.song_id ?? "test-song-id",
		analysis: partial.analysis ?? null,
		model: partial.model ?? "test-model",
		prompt_version: partial.prompt_version ?? null,
		tokens_used: partial.tokens_used ?? null,
		cost_cents: partial.cost_cents ?? null,
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
// computeEmotionDistribution
// ============================================================================

describe("computeEmotionDistribution", () => {
	it("returns empty object for empty analyses", () => {
		const distribution = computeEmotionDistribution([]);
		expect(distribution).toEqual({});
	});

	it("extracts dominant_mood from emotional field", () => {
		const analyses: SongAnalysis[] = [
			createSongAnalysis({
				song_id: "1",
				analysis: {
					emotional: {
						dominant_mood: "happy",
					},
				},
			}),
			createSongAnalysis({
				song_id: "2",
				analysis: {
					emotional: {
						dominant_mood: "sad",
					},
				},
			}),
		];
		const distribution = computeEmotionDistribution(analyses);
		expect(distribution).toEqual({
			happy: 1,
			sad: 1,
		});
	});

	it("extracts dominant_mood from emotional_profile field", () => {
		const analyses: SongAnalysis[] = [
			createSongAnalysis({
				song_id: "1",
				analysis: {
					emotional_profile: {
						dominant_mood: "happy",
					},
				},
			}),
		];
		const distribution = computeEmotionDistribution(analyses);
		expect(distribution).toEqual({
			happy: 1,
		});
	});

	it("extracts dominant_mood from nested analysis.emotional path", () => {
		const analyses: SongAnalysis[] = [
			createSongAnalysis({
				song_id: "1",
				analysis: {
					analysis: {
						emotional: {
							dominant_mood: "euphoric",
						},
					},
				},
			}),
		];
		const distribution = computeEmotionDistribution(analyses);
		expect(distribution).toEqual({
			euphoric: 1,
		});
	});

	it("accumulates mood counts correctly", () => {
		const analyses: SongAnalysis[] = [
			createSongAnalysis({
				song_id: "1",
				analysis: {
					emotional: { dominant_mood: "happy" },
				},
			}),
			createSongAnalysis({
				song_id: "2",
				analysis: {
					emotional: { dominant_mood: "happy" },
				},
			}),
			createSongAnalysis({
				song_id: "3",
				analysis: {
					emotional: { dominant_mood: "sad" },
				},
			}),
		];
		const distribution = computeEmotionDistribution(analyses);
		expect(distribution).toEqual({
			happy: 2,
			sad: 1,
		});
	});

	it("ignores analyses without dominant_mood", () => {
		const analyses: SongAnalysis[] = [
			createSongAnalysis({
				song_id: "1",
				analysis: {
					emotional: {},
				},
			}),
			createSongAnalysis({
				song_id: "2",
				analysis: null,
			}),
			createSongAnalysis({
				song_id: "3",
				analysis: {
					emotional: { dominant_mood: "happy" },
				},
			}),
		];
		const distribution = computeEmotionDistribution(analyses);
		expect(distribution).toEqual({
			happy: 1,
		});
	});
});
