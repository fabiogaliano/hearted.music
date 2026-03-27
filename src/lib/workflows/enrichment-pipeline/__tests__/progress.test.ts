import { describe, expect, it } from "vitest";
import { batchSizeForSequence, makeInitialProgress } from "../progress";

describe("batchSizeForSequence", () => {
	it("follows 1 → 5 → 10 → 25 → 50 progression", () => {
		expect(batchSizeForSequence(0)).toBe(1);
		expect(batchSizeForSequence(1)).toBe(5);
		expect(batchSizeForSequence(2)).toBe(10);
		expect(batchSizeForSequence(3)).toBe(25);
		expect(batchSizeForSequence(4)).toBe(50);
	});

	it("clamps at max batch size for large sequences", () => {
		expect(batchSizeForSequence(5)).toBe(50);
		expect(batchSizeForSequence(100)).toBe(50);
	});
});

describe("makeInitialProgress", () => {
	it("creates progress with batch size and sequence", () => {
		const progress = makeInitialProgress(10, 2, 100);
		expect(progress.batchSize).toBe(10);
		expect(progress.batchSequence).toBe(2);
		expect(progress.done).toBe(0);
		expect(progress.succeeded).toBe(0);
		expect(progress.failed).toBe(0);
	});

	it("tracks only the candidate-side enrichment stages", () => {
		const progress = makeInitialProgress(10, 2, 3);
		expect(progress.total).toBe(12);
		expect(Object.keys(progress.stages)).toEqual([
			"audio_features",
			"genre_tagging",
			"song_analysis",
			"song_embedding",
		]);
	});
});
