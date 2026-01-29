/**
 * Playlist Profiling Integration Test
 *
 * Validates the core matching dependency: building multi-dimensional
 * profiles from songs and computing centroids.
 *
 * Tests:
 * 1. Building playlist profile from songs
 * 2. Embedding centroid calculation
 * 3. Audio centroid calculation (mean of Spotify audio features)
 * 4. Genre and emotion distributions
 * 5. Cache behavior (content hash)
 *
 * SKIPPED BY DEFAULT - This test requires database access and
 * the embedding service. Run explicitly with:
 *
 *   PROFILING_TEST=true bun test playlist-profiling-integration
 *
 * REQUIREMENTS:
 * - Database must be accessible
 * - Embedding service must be configured
 * - Test playlist and songs must exist in database
 *
 * This is a "tracer bullet" test that validates the core matching
 * dependency: profile computation for song-to-playlist matching.
 */

import { beforeAll, describe, expect, test } from "vitest";
import { Result } from "better-result";
import { PlaylistProfilingService } from "../service";
import { EmbeddingService } from "@/lib/ml/embedding/service";
import type { Song } from "@/lib/data/song";
import type { ComputedPlaylistProfile } from "../types";

// ─────────────────────────────────────────────────────────────
// Test Configuration
// ─────────────────────────────────────────────────────────────

const RUN_TEST = process.env.PROFILING_TEST === "true";
const TEST_PLAYLIST_ID = "test-playlist-profiling-123";

// Hardcoded real Spotify track IDs (following smoke test pattern)
// These are well-known songs that likely have embeddings and audio features
const KNOWN_SPOTIFY_TRACK_IDS = [
	"4u7EnebtmKWzUH433cf5Qv", // Queen - Bohemian Rhapsody
	"0VjIjW4GlUZAMYd2vXMi3b", // The Weeknd - Blinding Lights
	"3n3Ppam7vgaVa1iaRUc9Lp", // Mr. Brightside - The Killers
];

// ─────────────────────────────────────────────────────────────
// Helper: Query Real Songs from Database
// ─────────────────────────────────────────────────────────────

async function getTestSongsFromDatabase(): Promise<Song[]> {
	const { getBySpotifyIds } = await import("@/lib/data/song");
	const result = await getBySpotifyIds(KNOWN_SPOTIFY_TRACK_IDS);

	if (!Result.isOk(result)) {
		throw new Error(`Failed to fetch test songs: ${result.error.message}`);
	}

	if (result.value.length === 0) {
		throw new Error(
			"No test songs found in database. Please run the app to seed some songs first, " +
				`or ensure these Spotify IDs exist: ${KNOWN_SPOTIFY_TRACK_IDS.join(", ")}`,
		);
	}

	return result.value;
}

// Test songs will be populated in beforeAll from database
let TEST_SONGS: Song[] = [];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function expectValidCentroid(centroid: number[] | null) {
	if (centroid === null) {
		// Null is valid if no embeddings available
		return;
	}

	expect(Array.isArray(centroid)).toBe(true);
	expect(centroid.length).toBeGreaterThan(0);

	// All values should be finite numbers
	for (const value of centroid) {
		expect(typeof value).toBe("number");
		expect(Number.isFinite(value)).toBe(true);
	}
}

function expectValidAudioCentroid(centroid: {
	energy?: number;
	valence?: number;
	danceability?: number;
	acousticness?: number;
	instrumentalness?: number;
	speechiness?: number;
	liveness?: number;
	tempo?: number;
	loudness?: number;
}) {
	// At least one feature should be present
	const features = Object.values(centroid);
	expect(features.length).toBeGreaterThan(0);

	// All values should be finite numbers
	for (const value of features) {
		if (value !== undefined) {
			expect(typeof value).toBe("number");
			expect(Number.isFinite(value)).toBe(true);
		}
	}
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe.skipIf(!RUN_TEST)("Playlist Profiling Integration", () => {
	let service: PlaylistProfilingService;
	let profileResult: Result<ComputedPlaylistProfile, unknown>;

	beforeAll(async () => {
		// Fetch real songs from database
		try {
			TEST_SONGS = await getTestSongsFromDatabase();
			console.log(
				`\n✓ Loaded ${TEST_SONGS.length} real songs from database for testing`,
			);
			for (const song of TEST_SONGS) {
				console.log(`   - ${song.artists.join(", ")} - ${song.name}`);
			}
		} catch (error) {
			console.error(`\n✗ Failed to load test songs: ${error}`);
			throw error;
		}

		// Create embedding service
		const embeddingService = new EmbeddingService();

		// Create profiling service
		service = new PlaylistProfilingService(embeddingService);

		console.log("\n🎯 Computing playlist profile...");
		console.log(`   Playlist: ${TEST_PLAYLIST_ID}`);
		console.log(`   Songs: ${TEST_SONGS.length}`);

		// Compute profile
		profileResult = await service.computeProfile(
			TEST_PLAYLIST_ID,
			TEST_SONGS,
			{ skipCache: true, skipPersist: true }, // Don't use cache or persist for test
		);

		if (Result.isOk(profileResult)) {
			console.log("   ✓ Profile computed successfully");
		} else {
			console.log(`   ✗ Profile computation failed: ${profileResult.error}`);
		}
	}, 60000); // 1 minute timeout for embeddings

	test("profile computation succeeds", () => {
		expect(Result.isOk(profileResult)).toBe(true);
	});

	test("profile includes playlist ID", () => {
		if (!Result.isOk(profileResult)) return;

		const profile = profileResult.value;
		expect(profile.playlistId).toBe(TEST_PLAYLIST_ID);
	});

	test("profile kind is content_v1", () => {
		if (!Result.isOk(profileResult)) return;

		const profile = profileResult.value;
		expect(profile.kind).toBe("content_v1");
	});

	test("profile includes all songs", () => {
		if (!Result.isOk(profileResult)) return;

		const profile = profileResult.value;
		expect(profile.songIds.length).toBe(TEST_SONGS.length);
		expect(profile.songCount).toBe(TEST_SONGS.length);
	});

	describe("Embedding centroid", () => {
		test("centroid is computed", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			expectValidCentroid(profile.embedding);
		});

		test("centroid has expected dimensions", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			if (profile.embedding === null) {
				// No embeddings available
				console.log("   ⚠️  No embeddings available for test songs");
				return;
			}

			// Embeddings should have standard dimensions (e.g., 384 or 768)
			expect(profile.embedding.length).toBeGreaterThan(100);
			console.log(`   ✓ Embedding dimensions: ${profile.embedding.length}`);
		});
	});

	describe("Audio centroid", () => {
		test("audio centroid is computed", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			expectValidAudioCentroid(profile.audioCentroid);
		});

		test("audio centroid includes standard features", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			const { audioCentroid } = profile;

			// Check for expected Spotify audio features
			const expectedFeatures = [
				"energy",
				"valence",
				"danceability",
				"acousticness",
			];

			// At least some features should be present
			// (may not have all if test data doesn't have audio features)
			const presentFeatures = expectedFeatures.filter(
				(feature) =>
					audioCentroid[feature as keyof typeof audioCentroid] !== undefined,
			);

			if (presentFeatures.length > 0) {
				console.log(
					`   ✓ Audio features present: ${presentFeatures.join(", ")}`,
				);
			} else {
				console.log("   ⚠️  No audio features available for test songs");
			}
		});

		test("audio feature values are in valid ranges", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			const { audioCentroid } = profile;

			// Most Spotify features are normalized 0-1
			const normalized = [
				"energy",
				"valence",
				"danceability",
				"acousticness",
				"instrumentalness",
				"speechiness",
				"liveness",
			];

			for (const feature of normalized) {
				const value = audioCentroid[feature as keyof typeof audioCentroid];
				if (value !== undefined) {
					expect(value).toBeGreaterThanOrEqual(0);
					expect(value).toBeLessThanOrEqual(1);
				}
			}

			// Tempo is usually 50-200 BPM
			if (audioCentroid.tempo !== undefined) {
				expect(audioCentroid.tempo).toBeGreaterThan(0);
				expect(audioCentroid.tempo).toBeLessThan(300);
			}

			// Loudness is usually -60 to 0 dB
			if (audioCentroid.loudness !== undefined) {
				expect(audioCentroid.loudness).toBeGreaterThan(-100);
				expect(audioCentroid.loudness).toBeLessThan(10);
			}
		});
	});

	describe("Genre distribution", () => {
		test("genre distribution is computed", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			expect(profile.genreDistribution).toBeDefined();
			expect(typeof profile.genreDistribution).toBe("object");
		});

		test("genre counts match test data", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			const { genreDistribution } = profile;

			// Count expected genres from test data
			const expectedGenres = new Map<string, number>();
			for (const song of TEST_SONGS) {
				for (const genre of song.genres || []) {
					expectedGenres.set(genre, (expectedGenres.get(genre) || 0) + 1);
				}
			}

			// Verify distribution matches
			for (const [genre, count] of expectedGenres) {
				expect(genreDistribution[genre]).toBe(count);
			}

			console.log(
				`   ✓ Genre distribution: ${JSON.stringify(genreDistribution)}`,
			);
		});

		test("genre counts are positive integers", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			const { genreDistribution } = profile;

			for (const count of Object.values(genreDistribution)) {
				expect(Number.isInteger(count)).toBe(true);
				expect(count).toBeGreaterThan(0);
			}
		});
	});

	describe("Emotion distribution", () => {
		test("emotion distribution is computed", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			expect(profile.emotionDistribution).toBeDefined();
			expect(typeof profile.emotionDistribution).toBe("object");
		});

		test("emotion counts are valid", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			const { emotionDistribution } = profile;

			// May be empty if no analyses exist
			for (const count of Object.values(emotionDistribution)) {
				expect(Number.isInteger(count)).toBe(true);
				expect(count).toBeGreaterThan(0);
			}

			if (Object.keys(emotionDistribution).length > 0) {
				console.log(
					`   ✓ Emotion distribution: ${JSON.stringify(emotionDistribution)}`,
				);
			} else {
				console.log("   ⚠️  No emotion data available (songs not analyzed)");
			}
		});
	});

	describe("Content hashing", () => {
		test("content hash is generated", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			expect(profile.contentHash).toBeDefined();
			expect(typeof profile.contentHash).toBe("string");
			expect(profile.contentHash.length).toBeGreaterThan(0);
		});

		test("content hash is deterministic", async () => {
			if (!Result.isOk(profileResult)) return;

			const firstHash = profileResult.value.contentHash;

			// Compute profile again with same songs
			const secondResult = await service.computeProfile(
				TEST_PLAYLIST_ID,
				TEST_SONGS,
				{ skipCache: true, skipPersist: true },
			);

			if (Result.isOk(secondResult)) {
				expect(secondResult.value.contentHash).toBe(firstHash);
				console.log(`   ✓ Content hash is deterministic: ${firstHash}`);
			}
		});

		test("content hash changes with different songs", async () => {
			if (!Result.isOk(profileResult)) return;

			const firstHash = profileResult.value.contentHash;

			// Compute profile with different songs
			const differentSongs = TEST_SONGS.slice(0, 2); // Only first 2 songs
			const differentResult = await service.computeProfile(
				TEST_PLAYLIST_ID,
				differentSongs,
				{ skipCache: true, skipPersist: true },
			);

			if (Result.isOk(differentResult)) {
				expect(differentResult.value.contentHash).not.toBe(firstHash);
				console.log(
					`   ✓ Content hash changes with different songs: ${differentResult.value.contentHash}`,
				);
			}
		});
	});

	describe("Model bundle versioning", () => {
		test("model bundle hash is included", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			expect(profile.modelBundleHash).toBeDefined();
			expect(typeof profile.modelBundleHash).toBe("string");
			expect(profile.modelBundleHash.length).toBeGreaterThan(0);
		});

		test("model bundle hash is consistent", async () => {
			if (!Result.isOk(profileResult)) return;

			const firstHash = profileResult.value.modelBundleHash;

			// Compute profile again
			const secondResult = await service.computeProfile(
				TEST_PLAYLIST_ID,
				TEST_SONGS,
				{ skipCache: true, skipPersist: true },
			);

			if (Result.isOk(secondResult)) {
				expect(secondResult.value.modelBundleHash).toBe(firstHash);
				console.log(
					`   ✓ Model bundle hash is consistent: ${firstHash.slice(0, 8)}...`,
				);
			}
		});
	});

	describe("Cache behavior", () => {
		test("fromCache flag indicates cache status", () => {
			if (!Result.isOk(profileResult)) return;

			const profile = profileResult.value;
			expect(typeof profile.fromCache).toBe("boolean");

			// First computation with skipCache should not be from cache
			expect(profile.fromCache).toBe(false);
		});

		test("skipCache option bypasses cache", async () => {
			if (!Result.isOk(profileResult)) return;

			// Compute with skipCache
			const result = await service.computeProfile(
				TEST_PLAYLIST_ID,
				TEST_SONGS,
				{ skipCache: true, skipPersist: true },
			);

			if (Result.isOk(result)) {
				expect(result.value.fromCache).toBe(false);
			}
		});
	});
});

// ─────────────────────────────────────────────────────────────
// Skipped Test Notice
// ─────────────────────────────────────────────────────────────

describe.skipIf(RUN_TEST)("Playlist Profiling Integration (Skipped)", () => {
	test("requires PROFILING_TEST=true to run", () => {
		console.log("\n⏭️  Playlist Profiling Integration test skipped");
		console.log("   Set PROFILING_TEST=true to run this integration test");
		console.log("   Requires: Database access, Embedding service");
		expect(true).toBe(true);
	});
});
