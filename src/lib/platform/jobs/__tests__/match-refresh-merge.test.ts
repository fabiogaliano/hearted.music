import { describe, expect, it } from "vitest";
import { createInitialMatchSnapshotRefreshProgress } from "@/lib/platform/jobs/progress/match-snapshot-refresh";
import {
	earliestAvailableAt,
	latestRequestedAt,
	maxQueuePriority,
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

describe("maxQueuePriority", () => {
	it("returns incoming when existing is null", () => {
		expect(maxQueuePriority(null, 50)).toBe(50);
	});

	it("returns incoming when it is higher than existing", () => {
		expect(maxQueuePriority(50, 200)).toBe(200);
	});

	it("returns existing when it is higher than incoming", () => {
		expect(maxQueuePriority(200, 50)).toBe(200);
	});

	it("returns the value when both are equal", () => {
		expect(maxQueuePriority(100, 100)).toBe(100);
	});

	// The pending-merge semantics: a later lower-priority request cannot demote
	// an interactive pending refresh that already holds priority 200.
	it("interactive pending refresh is not demoted by a lower-priority request", () => {
		const interactivePriority = 200;
		const billingPriority = 50;
		expect(maxQueuePriority(interactivePriority, billingPriority)).toBe(200);
	});

	// A later higher-priority request should promote an existing standard pending refresh.
	it("a higher-priority incoming request promotes an existing lower-priority pending refresh", () => {
		const standardPriority = 50;
		const interactivePriority = 200;
		expect(maxQueuePriority(standardPriority, interactivePriority)).toBe(200);
	});
});

describe("earliestAvailableAt", () => {
	it("returns existing when it is earlier than incoming", () => {
		expect(
			earliestAvailableAt(
				"2026-06-25T10:00:00.000Z",
				"2026-06-25T10:00:08.000Z",
			),
		).toBe("2026-06-25T10:00:00.000Z");
	});

	it("returns incoming when it is earlier than existing", () => {
		expect(
			earliestAvailableAt(
				"2026-06-25T10:00:08.000Z",
				"2026-06-25T10:00:00.000Z",
			),
		).toBe("2026-06-25T10:00:00.000Z");
	});

	it("returns either when both are equal", () => {
		const ts = "2026-06-25T10:00:00.000Z";
		expect(earliestAvailableAt(ts, ts)).toBe(ts);
	});

	// Pull-forward: an immediate trigger (availableAt = now) must win against a
	// debounced pending job that has a later available_at.
	it("immediate trigger pulls forward a debounced pending refresh", () => {
		const debounced = "2026-06-25T10:00:08.000Z";
		const immediate = "2026-06-25T10:00:00.000Z";
		expect(earliestAvailableAt(debounced, immediate)).toBe(immediate);
	});

	// A later debounced trigger must not push back an already-immediate pending refresh.
	it("debounced trigger does not push back an immediate pending refresh", () => {
		const immediate = "2026-06-25T10:00:00.000Z";
		const debounced = "2026-06-25T10:00:08.000Z";
		expect(earliestAvailableAt(immediate, debounced)).toBe(immediate);
	});
});
