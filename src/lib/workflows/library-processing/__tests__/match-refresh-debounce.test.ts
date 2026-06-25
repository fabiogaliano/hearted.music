import { describe, expect, it } from "vitest";
import {
	MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE,
	resolveMatchRefreshAvailableAt,
} from "../match-refresh-debounce";
import type { LibraryProcessingChange } from "../types";

describe("MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE", () => {
	it("assigns 8 s debounce to playlist config saves", () => {
		expect(
			MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE[
				"playlist_management_session_flushed"
			],
		).toBe(8_000);
	});

	it("assigns zero debounce to onboarding trigger", () => {
		expect(
			MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE[
				"onboarding_target_selection_confirmed"
			],
		).toBe(0);
	});

	it("assigns zero debounce to library sync", () => {
		expect(MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE["library_synced"]).toBe(0);
	});

	it("assigns zero debounce to enrichment completion", () => {
		expect(MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE["enrichment_completed"]).toBe(0);
	});

	it("covers every LibraryProcessingChange kind", () => {
		const allKinds: Array<LibraryProcessingChange["kind"]> = [
			"onboarding_target_selection_confirmed",
			"library_synced",
			"enrichment_completed",
			"enrichment_stopped",
			"match_snapshot_published",
			"match_snapshot_failed",
			"playlist_management_session_flushed",
			"enrichment_work_available",
			"songs_unlocked",
			"unlimited_activated",
			"candidate_access_revoked",
		];
		for (const kind of allKinds) {
			expect(MATCH_REFRESH_DEBOUNCE_MS_BY_CHANGE[kind]).toBeDefined();
		}
	});
});

describe("resolveMatchRefreshAvailableAt", () => {
	const now = new Date("2026-06-25T10:00:00.000Z");

	it("returns now + 8 s for playlist config saves", () => {
		const result = resolveMatchRefreshAvailableAt({
			changeKind: "playlist_management_session_flushed",
			now,
		});
		expect(result).toBe("2026-06-25T10:00:08.000Z");
	});

	it("returns now for zero-debounce triggers (immediate)", () => {
		const result = resolveMatchRefreshAvailableAt({
			changeKind: "library_synced",
			now,
		});
		expect(result).toBe("2026-06-25T10:00:00.000Z");
	});

	it("returns now for onboarding trigger", () => {
		const result = resolveMatchRefreshAvailableAt({
			changeKind: "onboarding_target_selection_confirmed",
			now,
		});
		expect(result).toBe("2026-06-25T10:00:00.000Z");
	});

	it("returns a future ISO timestamp for debounced triggers", () => {
		const result = resolveMatchRefreshAvailableAt({
			changeKind: "playlist_management_session_flushed",
			now,
		});
		const resultDate = new Date(result);
		expect(resultDate.getTime()).toBeGreaterThan(now.getTime());
	});

	// Pull-forward: an immediate trigger produces availableAt = now(), so
	// passing that to ensureMatchSnapshotRefreshJob overwrites a future
	// available_at on an existing debounced pending job.
	it("produces an availableAt <= now for zero-debounce triggers (pull-forward)", () => {
		const result = resolveMatchRefreshAvailableAt({
			changeKind: "enrichment_completed",
			now,
		});
		expect(new Date(result).getTime()).toBeLessThanOrEqual(now.getTime());
	});
});
