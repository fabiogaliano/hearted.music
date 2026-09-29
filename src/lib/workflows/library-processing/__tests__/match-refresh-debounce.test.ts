import { describe, expect, it } from "vitest";
import { resolveMatchRefreshAvailableAt } from "../match-refresh-debounce";

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
