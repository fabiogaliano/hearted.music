import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../db", () => ({ read: mocks.read }));

import { postHogActivity } from "../posthog";
import * as prodCreds from "../prod-creds";
import {
	getCoverageDbMetrics,
	getEconomicsMetrics,
	parseTelemetryRange,
} from "../telemetry-db";

const range = parseTelemetryRange("7d", new Date("2026-08-20T12:00:00.000Z"));

const EXCLUSION = "exclude_from_product_metrics";

/** Zero-valued row so any aggregate shape resolves without special-casing. */
const ZERO_ROW = {
	total_cost_usd: 0,
	total_calls: 0,
	total_input_tokens: 0,
	total_output_tokens: 0,
	analyzed_songs: 0,
	activated_accounts: 0,
	paid_accounts: 0,
	active_subscriptions: 0,
	new_activations: 0,
	prev_activations: 0,
	song_analysis_cost_usd: 0,
};

describe("product metrics exclusion", () => {
	beforeEach(() => {
		// Block body: returning the mock would register it as a teardown hook.
		mocks.read.mockReset();
	});

	it("reports product-audience spend filtered and all-account spend whole", async () => {
		// The two ledger scopes are distinguishable only by the account predicate,
		// so the mock answers by scope: filtered reads see 30, unfiltered see 100.
		mocks.read.mockImplementation(async (sql: string) => [
			{ ...ZERO_ROW, total_cost_usd: sql.includes(EXCLUSION) ? 30 : 100 },
		]);

		const report = await getEconomicsMetrics(range);

		expect(report.totalCostUsd).toBe(30);
		expect(report.allAccountCostUsd).toBe(100);
	});

	it("scopes every account-owned coverage fact to included accounts", async () => {
		const queries: string[] = [];
		mocks.read.mockImplementation(async (sql: string) => {
			queries.push(sql);
			return [];
		});

		await getCoverageDbMetrics(range);

		// PostHog coverage counts already drop excluded accounts; leaving a DB-side
		// subquery unscoped would show that gap as source drift instead of parity.
		const accountOwned = (queries[0] ?? "")
			.split("\n")
			.filter((line) =>
				/FROM (user_preferences|billing_activation|match_snapshot|match_event)\b/.test(
					line,
				),
			);
		expect(accountOwned.length).toBeGreaterThan(0);
		expect(accountOwned.filter((q) => !q.includes(EXCLUSION))).toEqual([]);
	});
});

describe("posthog exclusion clause", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.spyOn(prodCreds, "getPostHogCreds").mockReturnValue({
			apiKey: "phx_test_key_12345",
			projectId: "185471",
			apiHost: "https://eu.posthog.com",
		});
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("filters excluded account ids and never interpolates a non-uuid id", async () => {
		let sentQuery = "";
		globalThis.fetch = vi.fn(async (_url: string, init: RequestInit) => {
			sentQuery = JSON.parse(String(init.body)).query.query;
			return new Response(JSON.stringify({ results: [[0, 0, 0, null]] }), {
				status: 200,
			});
		}) as unknown as typeof fetch;

		await postHogActivity(
			"2026-08-01T00:00:00Z",
			"2026-08-16T00:00:00Z",
			[
				"3f0a1c62-1f2f-4f9a-9d0e-2b6d9d5f1a44",
				"'; DROP TABLE events; --",
			],
		);

		expect(sentQuery).toContain(
			"distinct_id NOT IN ('3f0a1c62-1f2f-4f9a-9d0e-2b6d9d5f1a44')",
		);
		expect(sentQuery).not.toContain("DROP TABLE");
	});
});
