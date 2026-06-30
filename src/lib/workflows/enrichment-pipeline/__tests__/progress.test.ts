import { describe, expect, it } from "vitest";
import { EnrichmentChunkProgressSchema } from "@/lib/platform/jobs/progress/enrichment";
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

	it("tracks all enrichment progress stages", () => {
		const progress = makeInitialProgress(10, 2, 3);
		expect(progress.total).toBe(15);
		expect(new Set(Object.keys(progress.stages))).toEqual(
			new Set([
				"audio_features",
				"genre_tagging",
				"song_analysis",
				"song_embedding",
				"content_activation",
			]),
		);
	});

	it("defaults selectionMode to 'normal' when not passed", () => {
		const progress = makeInitialProgress(10, 2, 100);
		expect(progress.selectionMode).toBe("normal");
	});

	it("stores 'first_match_bootstrap' when passed", () => {
		const progress = makeInitialProgress(10, 2, 100, "first_match_bootstrap");
		expect(progress.selectionMode).toBe("first_match_bootstrap");
	});
});

describe("EnrichmentChunkProgressSchema — selectionMode safety", () => {
	it("parses 'normal' as 'normal'", () => {
		const result = EnrichmentChunkProgressSchema.safeParse({
			total: 0,
			done: 0,
			succeeded: 0,
			failed: 0,
			batchSize: 1,
			batchSequence: 0,
			selectionMode: "normal",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.selectionMode).toBe("normal");
		}
	});

	it("parses 'first_match_bootstrap' as 'first_match_bootstrap'", () => {
		const result = EnrichmentChunkProgressSchema.safeParse({
			total: 0,
			done: 0,
			succeeded: 0,
			failed: 0,
			batchSize: 1,
			batchSequence: 0,
			selectionMode: "first_match_bootstrap",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.selectionMode).toBe("first_match_bootstrap");
		}
	});

	it("defaults to 'normal' when selectionMode is absent (old in-flight jobs)", () => {
		const result = EnrichmentChunkProgressSchema.safeParse({
			total: 0,
			done: 0,
			succeeded: 0,
			failed: 0,
			batchSize: 1,
			batchSequence: 0,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.selectionMode).toBe("normal");
		}
	});

	it("defaults to 'normal' when selectionMode is an unknown string", () => {
		const result = EnrichmentChunkProgressSchema.safeParse({
			total: 0,
			done: 0,
			succeeded: 0,
			failed: 0,
			batchSize: 1,
			batchSequence: 0,
			selectionMode: "legacy_mode_from_old_deploy",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			// .catch("normal") on the enum schema handles unknown values safely
			expect(result.data.selectionMode).toBe("normal");
		}
	});
});
