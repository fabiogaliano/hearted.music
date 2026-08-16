import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../db", () => ({ read: mocks.read }));

import { getFunnelCohort, parseTelemetryRange } from "../telemetry-db";

describe("telemetry funnel privacy threshold", () => {
	beforeEach(() => {
		mocks.read.mockResolvedValue([
			{
				id: "account-1",
				created_at: "2026-08-10T00:00:00.000Z",
				spotify_id: "spotify-1",
				onboarding_completed_at: "2026-08-10T00:10:00.000Z",
				first_synced_at: "2026-08-10T00:05:00.000Z",
				first_snapshot_at: "2026-08-10T00:15:00.000Z",
				first_event_at: "2026-08-10T00:20:00.000Z",
				first_add_at: "2026-08-10T00:25:00.000Z",
				first_paid_at: null,
			},
		]);
	});

	it("withholds conversion percentages for cohorts below ten accounts", async () => {
		const range = parseTelemetryRange(
			"7d",
			new Date("2026-08-17T00:00:00.000Z"),
		);
		const report = await getFunnelCohort(range);

		expect(report.hasSufficientData).toBe(false);
		expect(report.totalSignups).toBe(1);
		expect(
			report.stages.every(
				(stage) =>
					stage.conversionFromPrevious === null &&
					stage.conversionFromSignup === null,
			),
		).toBe(true);
	});
});
