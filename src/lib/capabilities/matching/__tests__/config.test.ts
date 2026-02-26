import { describe, expect, it } from "vitest";
import { computeAdaptiveWeights } from "../config";

describe("computeAdaptiveWeights", () => {
	it("returns default weights when all signals available", () => {
		const w = computeAdaptiveWeights({
			hasEmbedding: true,
			hasAudioFeatures: true,
			hasGenres: true,
		});
		expect(w.embedding).toBeCloseTo(0.5);
		expect(w.audio).toBeCloseTo(0.3);
		expect(w.genre).toBeCloseTo(0.2);
	});

	it("redistributes embedding weight proportionally when missing", () => {
		const w = computeAdaptiveWeights({
			hasEmbedding: false,
			hasAudioFeatures: true,
			hasGenres: true,
		});
		expect(w.embedding).toBe(0);
		expect(w.audio).toBeCloseTo(0.6);
		expect(w.genre).toBeCloseTo(0.4);
		expect(w.audio + w.genre).toBeCloseTo(1.0);
	});

	it("redistributes audio weight proportionally when missing", () => {
		const w = computeAdaptiveWeights({
			hasEmbedding: true,
			hasAudioFeatures: false,
			hasGenres: true,
		});
		expect(w.audio).toBe(0);
		expect(w.embedding).toBeCloseTo(0.714, 2);
		expect(w.genre).toBeCloseTo(0.286, 2);
		expect(w.embedding + w.genre).toBeCloseTo(1.0);
	});

	it("redistributes genre weight proportionally when missing", () => {
		const w = computeAdaptiveWeights({
			hasEmbedding: true,
			hasAudioFeatures: true,
			hasGenres: false,
		});
		expect(w.genre).toBe(0);
		expect(w.embedding).toBeCloseTo(0.625);
		expect(w.audio).toBeCloseTo(0.375);
		expect(w.embedding + w.audio).toBeCloseTo(1.0);
	});

	it("handles only one signal available", () => {
		const w = computeAdaptiveWeights({
			hasEmbedding: true,
			hasAudioFeatures: false,
			hasGenres: false,
		});
		expect(w.embedding).toBeCloseTo(1.0);
		expect(w.audio).toBe(0);
		expect(w.genre).toBe(0);
	});

	it("handles no signals available", () => {
		const w = computeAdaptiveWeights({
			hasEmbedding: false,
			hasAudioFeatures: false,
			hasGenres: false,
		});
		expect(w.embedding).toBe(0);
		expect(w.audio).toBe(0);
		expect(w.genre).toBe(0);
	});

	it("weights always sum to 1.0 when at least one signal present", () => {
		const combos = [
			{ hasEmbedding: true, hasAudioFeatures: true, hasGenres: false },
			{ hasEmbedding: true, hasAudioFeatures: false, hasGenres: true },
			{ hasEmbedding: false, hasAudioFeatures: true, hasGenres: true },
			{ hasEmbedding: true, hasAudioFeatures: false, hasGenres: false },
			{ hasEmbedding: false, hasAudioFeatures: true, hasGenres: false },
			{ hasEmbedding: false, hasAudioFeatures: false, hasGenres: true },
		];
		for (const combo of combos) {
			const w = computeAdaptiveWeights(combo);
			expect(w.embedding + w.audio + w.genre).toBeCloseTo(1.0);
		}
	});
});
