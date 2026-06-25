import { describe, expect, it } from "vitest";
import { createInitialMatchSnapshotRefreshProgress } from "@/lib/platform/jobs/progress/match-snapshot-refresh";
import {
	latestRequestedAt,
	mergeMatchRefreshProgress,
} from "../match-refresh-merge";

describe("latestRequestedAt", () => {
	it("returns incoming when existing is null", () => {
		expect(latestRequestedAt(null, "2026-06-25T10:00:00.000Z")).toBe(
			"2026-06-25T10:00:00.000Z",
		);
	});

	it("returns existing when it is later than incoming", () => {
		expect(
			latestRequestedAt("2026-06-25T11:00:00.000Z", "2026-06-25T10:00:00.000Z"),
		).toBe("2026-06-25T11:00:00.000Z");
	});

	it("returns incoming when it is later than existing", () => {
		expect(
			latestRequestedAt("2026-06-25T09:00:00.000Z", "2026-06-25T10:00:00.000Z"),
		).toBe("2026-06-25T10:00:00.000Z");
	});

	it("returns either when both are equal", () => {
		const ts = "2026-06-25T10:00:00.000Z";
		expect(latestRequestedAt(ts, ts)).toBe(ts);
	});
});

describe("mergeMatchRefreshProgress", () => {
	it("ORs needsTargetSongEnrichment: false + false → false", () => {
		const base = createInitialMatchSnapshotRefreshProgress({
			needsTargetSongEnrichment: false,
		});
		const result = mergeMatchRefreshProgress(base, false);
		expect(result.plan?.needsTargetSongEnrichment).toBe(false);
	});

	it("ORs needsTargetSongEnrichment: false + true → true", () => {
		const base = createInitialMatchSnapshotRefreshProgress({
			needsTargetSongEnrichment: false,
		});
		const result = mergeMatchRefreshProgress(base, true);
		expect(result.plan?.needsTargetSongEnrichment).toBe(true);
	});

	it("ORs needsTargetSongEnrichment: true + false → true", () => {
		const base = createInitialMatchSnapshotRefreshProgress({
			needsTargetSongEnrichment: true,
		});
		const result = mergeMatchRefreshProgress(base, false);
		expect(result.plan?.needsTargetSongEnrichment).toBe(true);
	});

	it("ORs needsTargetSongEnrichment: true + true → true", () => {
		const base = createInitialMatchSnapshotRefreshProgress({
			needsTargetSongEnrichment: true,
		});
		const result = mergeMatchRefreshProgress(base, true);
		expect(result.plan?.needsTargetSongEnrichment).toBe(true);
	});

	it("preserves existing stage state when parsing succeeds", () => {
		const base = createInitialMatchSnapshotRefreshProgress({
			needsTargetSongEnrichment: false,
		});
		// Simulate a stage being in running state (shouldn't happen for pending
		// jobs but ensures we don't wipe data on a valid progress parse)
		const modified = {
			...base,
			stages: {
				...base.stages,
				playlist_profiling: {
					status: "running" as const,
					succeeded: 0,
					failed: 0,
				},
			},
		};
		const result = mergeMatchRefreshProgress(modified, true);
		expect(result.stages.playlist_profiling?.status).toBe("running");
	});

	it("falls back to initial progress when existing progress is unparseable", () => {
		const result = mergeMatchRefreshProgress({ invalid: true }, true);
		expect(result.plan?.needsTargetSongEnrichment).toBe(true);
		expect(result.total).toBe(5);
	});

	it("treats missing plan.needsTargetSongEnrichment as false", () => {
		const base = createInitialMatchSnapshotRefreshProgress({
			needsTargetSongEnrichment: false,
		});
		// Remove the plan field
		const { plan: _plan, ...noPlan } = base;
		const result = mergeMatchRefreshProgress(noPlan, false);
		expect(result.plan?.needsTargetSongEnrichment).toBe(false);
	});
});
