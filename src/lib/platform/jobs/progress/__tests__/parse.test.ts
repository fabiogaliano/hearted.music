import { describe, expect, it } from "vitest";
import { parseJobProgress } from "../parse";

describe("parseJobProgress", () => {
	it("parses enrichment progress", () => {
		const raw = {
			total: 20,
			done: 10,
			succeeded: 8,
			failed: 2,
			currentStage: "song_analysis",
			stages: {
				audio_features: { status: "completed", succeeded: 5, failed: 0 },
			},
			batchSize: 5,
			batchSequence: 1,
		};

		const result = parseJobProgress("enrichment", raw);

		expect(result.type).toBe("enrichment");
		if (result.type === "enrichment") {
			expect(result.progress.batchSize).toBe(5);
			expect(result.progress.currentStage).toBe("song_analysis");
			expect(result.progress.stages.genre_tagging?.status).toBe("pending");
		}
	});

	it("parses match_snapshot_refresh progress", () => {
		const raw = {
			total: 5,
			done: 2,
			succeeded: 2,
			failed: 0,
			currentStage: "playlist_profiling",
			stages: {
				target_song_enrichment: {
					status: "skipped",
					succeeded: 0,
					failed: 0,
				},
			},
			playlistCount: 3,
			candidateCount: 42,
		};

		const result = parseJobProgress("match_snapshot_refresh", raw);

		expect(result.type).toBe("match_snapshot_refresh");
		if (result.type === "match_snapshot_refresh") {
			expect(result.progress.playlistCount).toBe(3);
			expect(result.progress.candidateCount).toBe(42);
			expect(result.progress.stages.matching?.status).toBe("pending");
		}
	});

	it("returns unknown for unrecognized job types", () => {
		const result = parseJobProgress("sync_liked_songs", { total: 0 });

		expect(result.type).toBe("unknown");
		expect(result.progress).toBeNull();
	});

	it("fills defaults for partial enrichment progress", () => {
		const result = parseJobProgress("enrichment", {});

		expect(result.type).toBe("enrichment");
		if (result.type === "enrichment") {
			expect(result.progress.total).toBe(0);
			expect(result.progress.batchSize).toBe(0);
			expect(result.progress.stages.audio_features?.status).toBe("pending");
		}
	});

	it("fills defaults for partial match refresh progress", () => {
		const result = parseJobProgress("match_snapshot_refresh", {});

		expect(result.type).toBe("match_snapshot_refresh");
		if (result.type === "match_snapshot_refresh") {
			expect(result.progress.total).toBe(5);
			expect(result.progress.playlistCount).toBeUndefined();
			expect(result.progress.stages.publishing?.status).toBe("pending");
		}
	});
});
