import { describe, expect, it } from "vitest";
import { buildRefreshPlan } from "../planner";
import type { RefreshSource } from "../types";

describe("buildRefreshPlan", () => {
	it("enables target-song enrichment for enrichment_drain", () => {
		const plan = buildRefreshPlan("enrichment_drain");
		expect(plan.shouldEnrichTargetPlaylistSongs).toBe(true);
		expect(plan.source).toBe("enrichment_drain");
	});

	it("enables target-song enrichment for sync_target_track_change", () => {
		const plan = buildRefreshPlan("sync_target_track_change");
		expect(plan.shouldEnrichTargetPlaylistSongs).toBe(true);
	});

	it("enables target-song enrichment for target_selection", () => {
		const plan = buildRefreshPlan("target_selection");
		expect(plan.shouldEnrichTargetPlaylistSongs).toBe(true);
	});

	it("skips target-song enrichment for liked-song removal", () => {
		const plan = buildRefreshPlan("sync_liked_removal");
		expect(plan.shouldEnrichTargetPlaylistSongs).toBe(false);
	});

	it("skips target-song enrichment for metadata-only target changes", () => {
		const plan = buildRefreshPlan("sync_target_metadata_change");
		expect(plan.shouldEnrichTargetPlaylistSongs).toBe(false);
	});

	it("skips target-song enrichment for target removal", () => {
		const plan = buildRefreshPlan("sync_target_removal");
		expect(plan.shouldEnrichTargetPlaylistSongs).toBe(false);
	});

	it("skips target-song enrichment when all targets removed", () => {
		const plan = buildRefreshPlan("sync_all_targets_removed");
		expect(plan.shouldEnrichTargetPlaylistSongs).toBe(false);
	});

	it("skips target-song enrichment for manual refresh", () => {
		const plan = buildRefreshPlan("manual");
		expect(plan.shouldEnrichTargetPlaylistSongs).toBe(false);
	});

	it("preserves the source in the returned plan", () => {
		const sources: RefreshSource[] = [
			"enrichment_drain",
			"sync_liked_removal",
			"sync_target_track_change",
			"sync_target_metadata_change",
			"sync_target_removal",
			"sync_all_targets_removed",
			"target_selection",
			"manual",
		];
		for (const source of sources) {
			expect(buildRefreshPlan(source).source).toBe(source);
		}
	});
});
