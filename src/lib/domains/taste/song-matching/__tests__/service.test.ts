import { Result } from "better-result";
import { describe, expect, it } from "vitest";
import { createMatchingService } from "../service";
import type {
	MatchingAudioFeatures,
	MatchingPlaylistProfile,
	MatchingSong,
} from "../types";

function audio(energy: number): MatchingAudioFeatures {
	return {
		energy,
		valence: 0.5,
		danceability: 0.5,
		acousticness: 0.5,
		instrumentalness: 0.5,
		speechiness: 0.5,
		liveness: 0.5,
		tempo: 120,
		loudness: -10,
	};
}

function song(over: Partial<MatchingSong> = {}): MatchingSong {
	return {
		id: "song-1",
		spotifyId: "sp-1",
		name: "Track",
		artists: ["Artist"],
		genres: ["pop"],
		audioFeatures: audio(1.0),
		...over,
	};
}

function profile(
	id: string,
	embedding: number[] | null,
	centroidEnergy: number | null,
): MatchingPlaylistProfile {
	return {
		playlistId: id,
		embedding,
		audioCentroid: centroidEnergy === null ? {} : { energy: centroidEnergy },
		genreDistribution: {},
	};
}

function embeddingAtCosine(cos: number): number[] {
	return [cos, Math.sqrt(1 - cos * cos)];
}

async function matchOne(service: ReturnType<typeof createMatchingService>) {
	// Two candidates with opposite signal strengths, embeddings in the realistic
	// E5 band so the compressed-range problem is actually present:
	//   A: best embedding (cos 0.90), worst audio (energy diff 1 → 0)
	//   B: weaker embedding (cos 0.75), best audio (energy diff 0 → 1)
	const profiles = [
		profile("A", embeddingAtCosine(0.9), 0.0),
		profile("B", embeddingAtCosine(0.75), 1.0),
	];
	const result = await service.matchBatch(
		[song()],
		profiles,
		new Map([["song-1", [1, 0]]]),
	);
	expect(Result.isOk(result)).toBe(true);
	if (Result.isError(result)) throw result.error;
	return result.value.matches.get("song-1") ?? [];
}

describe("MatchingService — candidate-set normalization", () => {
	it("normalization lets the higher-weighted embedding signal win the flip", async () => {
		// With enough samples this would be the production path; here minSamples is
		// dropped to 2 so the 2-candidate set normalizes.
		const normalized = createMatchingService(null, null, {
			minScoreThreshold: 0,
			normalization: {
				enabled: true,
				method: "zscore",
				minSamples: 2,
				fallbackSimilarityBaseline: 0.5,
			},
		});
		const ranked = await matchOne(normalized);
		expect(ranked.map((r) => r.playlistId)).toEqual(["A", "B"]);
	});

	it("without normalization even the stretched embedding band lets audio dominate", async () => {
		// The fallback stretch maps cos 0.90→0.8 and 0.75→0.5 — still much less
		// differential range than audio's full 0–1, so audio steers the ranking.
		// This is the original mis-scaling the candidate-set normalization fixes.
		const raw = createMatchingService(null, null, {
			minScoreThreshold: 0,
			normalization: {
				enabled: false,
				method: "zscore",
				minSamples: 2,
				fallbackSimilarityBaseline: 0.5,
			},
		});
		const ranked = await matchOne(raw);
		expect(ranked.map((r) => r.playlistId)).toEqual(["B", "A"]);
	});

	it("an under-sampled candidate set falls back to legacy scaling (small-set guard)", async () => {
		// Default minSamples (8) is above the 2-candidate set, so the guard
		// applies the fallback stretch — the result matches the un-normalized
		// ordering.
		const guarded = createMatchingService(null, null, {
			minScoreThreshold: 0,
		});
		const ranked = await matchOne(guarded);
		expect(ranked.map((r) => r.playlistId)).toEqual(["B", "A"]);
	});

	it("the fallback stretches the embedding from the configured baseline", async () => {
		const service = createMatchingService(null, null, {
			minScoreThreshold: 0,
			normalization: {
				enabled: false,
				method: "zscore",
				minSamples: 2,
				fallbackSimilarityBaseline: 0.5,
			},
		});
		const ranked = await matchOne(service);
		const a = ranked.find((r) => r.playlistId === "A");
		// cos 0.90 stretched from baseline 0.5 → (0.9 - 0.5) / 0.5 = 0.8
		expect(a?.normalizedFactors.embedding).toBeCloseTo(0.8, 6);
	});
});

describe("MatchingService — result shape", () => {
	it("assigns contiguous ranks and bounded normalized factors", async () => {
		const service = createMatchingService(null, null, {
			minScoreThreshold: 0,
			normalization: {
				enabled: true,
				method: "zscore",
				minSamples: 2,
				fallbackSimilarityBaseline: 0.5,
			},
		});
		const ranked = await matchOne(service);

		expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
		for (const r of ranked) {
			for (const v of Object.values(r.normalizedFactors)) {
				expect(v).toBeGreaterThanOrEqual(0);
				expect(v).toBeLessThanOrEqual(1);
			}
			// Raw factors are preserved alongside the normalized fusion inputs.
			expect(r.factors).toBeDefined();
		}
	});

	it("redistributes weight and zeroes the factor when a signal is missing", async () => {
		const service = createMatchingService(null, null, {
			minScoreThreshold: 0,
			normalization: {
				enabled: true,
				method: "zscore",
				minSamples: 2,
				fallbackSimilarityBaseline: 0.5,
			},
		});
		const result = await service.matchBatch(
			[song({ audioFeatures: null })],
			[profile("A", [1, 0], 0.0), profile("B", [0.6, 0.8], 1.0)],
			new Map([["song-1", [1, 0]]]),
		);
		if (Result.isError(result)) throw result.error;
		const ranked = result.value.matches.get("song-1") ?? [];
		expect(ranked.length).toBe(2);
		for (const r of ranked) {
			expect(r.normalizedFactors.audio).toBe(0);
			// embedding + genre available → 2 of 3 signals.
			expect(r.confidence).toBeCloseTo(2 / 3);
		}
	});

	it("is deterministic for identical input", async () => {
		const make = () =>
			createMatchingService(null, null, {
				minScoreThreshold: 0,
				normalization: {
					enabled: true,
					method: "zscore",
					minSamples: 2,
					fallbackSimilarityBaseline: 0.5,
				},
			});
		const a = await matchOne(make());
		const b = await matchOne(make());
		expect(a.map((r) => [r.playlistId, r.score])).toEqual(
			b.map((r) => [r.playlistId, r.score]),
		);
	});
});

describe("MatchingService — batch bookkeeping", () => {
	it("returns empty result for no songs or no profiles", async () => {
		const service = createMatchingService(null, null);
		const noSongs = await service.matchBatch([], [profile("A", [1, 0], 0.0)]);
		if (Result.isError(noSongs)) throw noSongs.error;
		expect(noSongs.value.matches.size).toBe(0);
		expect(noSongs.value.stats.total).toBe(0);
	});

	it("reports songs whose every playlist was excluded", async () => {
		const service = createMatchingService(null, null, { minScoreThreshold: 0 });
		const result = await service.matchBatch(
			[song()],
			[profile("A", [1, 0], 0.0)],
			new Map([["song-1", [1, 0]]]),
			{ exclusionSet: new Set(["song-1:A"]) },
		);
		if (Result.isError(result)) throw result.error;
		expect(result.value.excluded).toEqual(["song-1"]);
		expect(result.value.matches.size).toBe(0);
	});

	it("matchSong returns empty for no profiles", () => {
		const service = createMatchingService(null, null);
		const result = service.matchSong(song(), []);
		if (Result.isError(result)) throw result.error;
		expect(result.value).toEqual([]);
	});
});
