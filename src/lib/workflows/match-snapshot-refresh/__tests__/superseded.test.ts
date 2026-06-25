import { describe, expect, it } from "vitest";
import { isMatchRefreshJobSuperseded } from "../superseded";

describe("isMatchRefreshJobSuperseded", () => {
	it("returns false when job.satisfies_requested_at is null (legacy job)", () => {
		expect(
			isMatchRefreshJobSuperseded(
				{ satisfies_requested_at: null },
				"2026-06-25T10:00:00Z",
			),
		).toBe(false);
	});

	it("returns false when latestRequestedAt is null", () => {
		expect(
			isMatchRefreshJobSuperseded(
				{ satisfies_requested_at: "2026-06-25T09:00:00Z" },
				null,
			),
		).toBe(false);
	});

	it("returns true when latestRequestedAt is newer than job's satisfies_requested_at", () => {
		expect(
			isMatchRefreshJobSuperseded(
				{ satisfies_requested_at: "2026-06-25T09:00:00Z" },
				"2026-06-25T10:00:00Z",
			),
		).toBe(true);
	});

	it("returns false when latestRequestedAt equals job's satisfies_requested_at", () => {
		expect(
			isMatchRefreshJobSuperseded(
				{ satisfies_requested_at: "2026-06-25T10:00:00Z" },
				"2026-06-25T10:00:00Z",
			),
		).toBe(false);
	});

	it("returns false when latestRequestedAt is older than job's satisfies_requested_at", () => {
		expect(
			isMatchRefreshJobSuperseded(
				{ satisfies_requested_at: "2026-06-25T11:00:00Z" },
				"2026-06-25T10:00:00Z",
			),
		).toBe(false);
	});
});
