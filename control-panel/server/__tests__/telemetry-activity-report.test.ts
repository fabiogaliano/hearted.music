import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PostHogFetchError } from "../posthog";

const mocks = vi.hoisted(() => ({
	getPostHogRouteUsage: vi.fn(),
}));

vi.mock("../telemetry-db", () => ({
	parseTelemetryRange: () => ({
		preset: "7d",
		from: new Date("2026-08-10T12:00:00.000Z"),
		to: new Date("2026-08-17T12:00:00.000Z"),
		previousFrom: new Date("2026-08-03T12:00:00.000Z"),
		previousTo: new Date("2026-08-10T12:00:00.000Z"),
		fromIso: "2026-08-10T12:00:00.000Z",
		toIso: "2026-08-17T12:00:00.000Z",
	}),
	getDbSourceStatus: vi.fn().mockResolvedValue({
		status: "available",
		fetchedAt: "2026-08-17T12:00:00.000Z",
		latestObservedAt: "2026-08-17T11:59:00.000Z",
	}),
	getActivityMetrics: vi.fn().mockResolvedValue({
		dailyActive: [],
		current24hActive: 1,
		currentWau: 2,
		currentMau: 3,
		cohortRetention: [],
	}),
	excludedProductMetricsAccountIds: vi.fn().mockResolvedValue([]),
	getCoverageDbMetrics: vi.fn(),
	getEconomicsMetrics: vi.fn(),
	getEngagementMetrics: vi.fn(),
	getFunnelCohort: vi.fn(),
}));

vi.mock("../telemetry-posthog", () => ({
	getCachedPostHogSourceStatus: vi.fn().mockResolvedValue({
		status: "available",
		fetchedAt: "2026-08-17T12:00:00.000Z",
		latestObservedAt: "2026-08-17T11:59:00.000Z",
	}),
	getCachedPostHogActivity: vi.fn().mockResolvedValue(
		Result.ok({
			visitors: 3,
			pageviews: 5,
			sessions: 2,
			latestObservedAt: "2026-08-17T11:59:00.000Z",
		}),
	),
	getCachedPostHogRouteUsage: mocks.getPostHogRouteUsage,
	getCachedPostHogEventCoverage: vi.fn(),
}));

import { getTelemetryActivity } from "../telemetry-reports";

describe("telemetry activity report source status", () => {
	beforeEach(() => {
		mocks.getPostHogRouteUsage.mockResolvedValue(
			Result.err(new PostHogFetchError("route query failed", 503)),
		);
	});

	it("marks PostHog unavailable and explains a route-only query failure", async () => {
		const report = await getTelemetryActivity("7d", true);

		expect(report.sources.posthog).toEqual({
			status: "unavailable",
			message: "route query failed",
		});
		expect(report.data.observedWebActivity.pageviews).toBe(5);
		expect(report.data.routeUsage).toEqual([]);
		expect(report.caveats).toContain(
			"PostHog route usage query failed (route query failed); route usage is omitted.",
		);
	});
});
