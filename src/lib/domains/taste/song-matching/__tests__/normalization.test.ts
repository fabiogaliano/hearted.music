import { describe, expect, it } from "vitest";
import {
	computeSignalStats,
	normalizeSignal,
	stretchFromBaseline,
} from "../normalization";

describe("computeSignalStats", () => {
	it("returns zeroed stats for an empty set", () => {
		const s = computeSignalStats([]);
		expect(s).toEqual({ n: 0, min: 0, max: 0, mean: 0, std: 0 });
	});

	it("yields zero spread for a single sample", () => {
		const s = computeSignalStats([0.82]);
		expect(s.n).toBe(1);
		expect(s.min).toBe(0.82);
		expect(s.max).toBe(0.82);
		expect(s.mean).toBeCloseTo(0.82);
		expect(s.std).toBe(0);
	});

	it("computes mean, population std, min and max", () => {
		const s = computeSignalStats([0, 0.5, 1]);
		expect(s.min).toBe(0);
		expect(s.max).toBe(1);
		expect(s.mean).toBeCloseTo(0.5);
		// population std of {0, .5, 1} = sqrt((0.25+0+0.25)/3)
		expect(s.std).toBeCloseTo(Math.sqrt(0.5 / 3), 6);
	});
});

describe("normalizeSignal (zscore)", () => {
	const stats = computeSignalStats([0, 0.5, 1]); // mean 0.5, std ~0.408

	it("maps the mean to the neutral midpoint", () => {
		expect(normalizeSignal(0.5, stats, "zscore")).toBeCloseTo(0.5, 6);
	});

	it("clips beyond ±3σ to the [0,1] endpoints", () => {
		const far = stats.mean + 10 * stats.std;
		const low = stats.mean - 10 * stats.std;
		expect(normalizeSignal(far, stats, "zscore")).toBeCloseTo(1, 6);
		expect(normalizeSignal(low, stats, "zscore")).toBeCloseTo(0, 6);
	});

	it("places +1σ and -1σ symmetrically around 0.5", () => {
		const hi = normalizeSignal(stats.mean + stats.std, stats, "zscore");
		const lo = normalizeSignal(stats.mean - stats.std, stats, "zscore");
		expect(hi).toBeCloseTo(4 / 6, 6); // (1+3)/6
		expect(lo).toBeCloseTo(2 / 6, 6); // (-1+3)/6
	});

	it("returns the neutral 0.5 when the set has no spread", () => {
		const flat = computeSignalStats([0.7, 0.7, 0.7]);
		expect(normalizeSignal(0.7, flat, "zscore")).toBe(0.5);
	});

	it("returns 0.5 for an empty distribution", () => {
		expect(normalizeSignal(0.9, computeSignalStats([]), "zscore")).toBe(0.5);
	});
});

describe("normalizeSignal (minmax)", () => {
	const stats = computeSignalStats([0.2, 0.5, 0.9]);

	it("maps the observed min and max to 0 and 1", () => {
		expect(normalizeSignal(0.2, stats, "minmax")).toBe(0);
		expect(normalizeSignal(0.9, stats, "minmax")).toBe(1);
	});

	it("scales interior values linearly", () => {
		expect(normalizeSignal(0.5, stats, "minmax")).toBeCloseTo(
			(0.5 - 0.2) / (0.9 - 0.2),
			6,
		);
	});

	it("returns the neutral 0.5 when min equals max", () => {
		const flat = computeSignalStats([0.4, 0.4]);
		expect(normalizeSignal(0.4, flat, "minmax")).toBe(0.5);
	});

	it("narrow-band inputs are stretched across the full range", () => {
		// The embedding mis-scaling this module fixes: a tight 0.80-0.88 band
		// becomes a full 0-1 spread, restoring its differential influence.
		const band = computeSignalStats([0.8, 0.84, 0.88]);
		expect(normalizeSignal(0.8, band, "minmax")).toBe(0);
		expect(normalizeSignal(0.88, band, "minmax")).toBe(1);
	});
});

describe("stretchFromBaseline", () => {
	it("maps baseline to 0 and 1.0 to 1.0", () => {
		expect(stretchFromBaseline(0.5, 0.5)).toBe(0);
		expect(stretchFromBaseline(1.0, 0.5)).toBe(1);
		expect(stretchFromBaseline(0.75, 0.5)).toBeCloseTo(0.5, 6);
	});

	it("clamps values below the baseline to 0", () => {
		expect(stretchFromBaseline(0.3, 0.5)).toBe(0);
	});

	it("degrades to a plain clamp when the baseline leaves no range", () => {
		expect(stretchFromBaseline(0.8, 1)).toBe(0.8);
	});
});
