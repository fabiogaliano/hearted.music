import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../db", () => ({ read: mocks.read }));

import {
	getEconomicsMetrics,
	getEngagementMetrics,
	parseTelemetryRange,
} from "../telemetry-db";

const range = parseTelemetryRange(
	"7d",
	new Date("2026-08-20T12:00:00.000Z"),
);

describe("telemetry engagement and economics definitions", () => {
	beforeEach(() => mocks.read.mockReset());

	it("uses captured visible pairs for suggestions served and served add rate", async () => {
		mocks.read
			.mockResolvedValueOnce([
				{
					added: 2,
					dismissed: 1,
					skipped: 4,
					engaged_accounts: 1,
					match_sessions: 1,
					song_orientation_count: 4,
					playlist_orientation_count: 3,
					sessions_started: 1,
					sessions_completed: 0,
					suggestions_served: 10,
				},
			])
			.mockResolvedValueOnce([
				{ median_snap_to_decision: null, median_decision_to_add: null },
			]);

		const report = await getEngagementMetrics(range);

		expect(report.suggestionsServed).toBe(10);
		expect(report.totalDecisions).toBe(3);
		expect(report.servedAddRate).toBe(20);
	});

	it("uses only song-analysis work in cost per analyzed song", async () => {
		mocks.read
			.mockResolvedValueOnce([
				{
					total_cost_usd: 100,
					total_calls: 10,
					total_input_tokens: 1000,
					total_output_tokens: 200,
				},
			])
			.mockResolvedValueOnce([{ total_cost_usd: 50 }])
			.mockResolvedValueOnce([{ total_cost_usd: 120 }])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					analyzed_songs: 2,
					activated_accounts: 1,
					paid_accounts: 1,
					active_subscriptions: 1,
					new_activations: 1,
					prev_activations: 0,
					song_analysis_cost_usd: 4,
				},
			]);

		const report = await getEconomicsMetrics(range);

		expect(report.totalCostUsd).toBe(100);
		expect(report.allAccountCostUsd).toBe(120);
		expect(report.costPerAnalyzedSong).toBe(2);
	});
});
