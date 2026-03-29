import { describe, expect, it } from "vitest";
import { EnrichmentChunkProgressSchema } from "@/lib/platform/jobs/progress/enrichment";

describe("EnrichmentChunkProgressSchema", () => {
	it("validates a complete progress object", () => {
		const progress = {
			total: 50,
			done: 30,
			succeeded: 28,
			failed: 2,
			currentStage: "song_analysis",
			stages: {
				audio_features: { status: "completed", succeeded: 50, failed: 0 },
				genre_tagging: { status: "completed", succeeded: 48, failed: 2 },
				song_analysis: { status: "running", succeeded: 28, failed: 2 },
			},
			batchSize: 50,
			batchSequence: 4,
		};

		const result = EnrichmentChunkProgressSchema.safeParse(progress);
		expect(result.success).toBe(true);
	});

	it("applies defaults for optional fields", () => {
		const minimal = {
			total: 10,
			done: 0,
			succeeded: 0,
			failed: 0,
			batchSize: 1,
			batchSequence: 0,
		};

		const result = EnrichmentChunkProgressSchema.parse(minimal);
		expect(result.stages).toEqual({});
		expect(result.currentStage).toBeUndefined();
	});

	it("rejects invalid stage status", () => {
		const invalid = {
			total: 10,
			done: 0,
			succeeded: 0,
			failed: 0,
			batchSize: 1,
			batchSequence: 0,
			stages: {
				audio_features: {
					status: "invalid_status",
					succeeded: 0,
					failed: 0,
				},
			},
		};

		const result = EnrichmentChunkProgressSchema.safeParse(invalid);
		expect(result.success).toBe(false);
	});

	it("rejects negative counts", () => {
		const invalid = {
			total: -1,
			done: 0,
			succeeded: 0,
			failed: 0,
			batchSize: 1,
			batchSequence: 0,
		};

		const result = EnrichmentChunkProgressSchema.safeParse(invalid);
		expect(result.success).toBe(false);
	});

	it("accepts all valid stage statuses", () => {
		const statuses = [
			"pending",
			"running",
			"completed",
			"failed",
			"skipped",
		] as const;

		for (const status of statuses) {
			const progress = {
				total: 10,
				done: 0,
				succeeded: 0,
				failed: 0,
				batchSize: 1,
				batchSequence: 0,
				stages: {
					test_stage: { status, succeeded: 0, failed: 0 },
				},
			};

			const result = EnrichmentChunkProgressSchema.safeParse(progress);
			expect(result.success).toBe(true);
		}
	});

	it("applies defaults to stage succeeded/failed counts", () => {
		const progress = {
			total: 10,
			done: 0,
			succeeded: 0,
			failed: 0,
			batchSize: 1,
			batchSequence: 0,
			stages: {
				audio_features: { status: "pending" },
			},
		};

		const result = EnrichmentChunkProgressSchema.parse(progress);
		expect(result.stages.audio_features.succeeded).toBe(0);
		expect(result.stages.audio_features.failed).toBe(0);
	});
});
