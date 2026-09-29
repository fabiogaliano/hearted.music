// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const range = {
	from: "2026-07-17T12:00:00Z",
	to: "2026-08-16T12:00:00Z",
	timezone: "UTC",
	preset: "30d",
};

const availableSources = {
	supabase: {
		status: "available",
		fetchedAt: "2026-08-16T12:00:00Z",
		latestObservedAt: "2026-08-16T11:50:00Z",
	},
	posthog: {
		status: "available",
		fetchedAt: "2026-08-16T12:00:00Z",
		latestObservedAt: "2026-08-16T11:45:00Z",
	},
};

const mockActivity = {
	generatedAt: "2026-08-16T12:00:00Z",
	range,
	data: {
		dailyActive: [
			{ date: "2026-08-15", count: 12, isComplete: false },
			{ date: "2026-08-16", count: 15, isComplete: true },
		],
		current24hActive: 10,
		currentWau: 19,
		currentMau: 38,
		cohortRetention: [
			{
				cohortWeek: "2026-08-03",
				signups: 10,
				week1Active: null,
				week1Rate: null,
				week4Active: null,
				week4Rate: null,
				isWeek1Mature: false,
				isWeek4Mature: false,
			},
		],
		observedWebActivity: {
			visitors: null,
			pageviews: null,
			sessions: null,
			latestObservedAt: null,
		},
		routeUsage: [
			{ pathname: "/match", count: 240 },
			{ pathname: "/dashboard", count: 180 },
		],
	},
	sources: {
		supabase: availableSources.supabase,
		posthog: {
			status: "unavailable",
			message: "PostHog API unreachable",
		},
	},
	caveats: ["PostHog API is unavailable; showing database facts only."],
};

const mockEconomics = {
	generatedAt: "2026-08-16T12:00:00Z",
	range,
	data: {
		totalCostUsd: 12.3456,
		allAccountCostUsd: 15.6789,
		totalCalls: 340,
		totalInputTokens: 250000,
		totalOutputTokens: 85000,
		previousPeriodCostUsd: 8.9012,
		costDeltaPercent: 38.7,
		byFunction: [
			{
				functionId: "song-analysis",
				calls: 200,
				costUsd: 8.5,
				inputTokens: 150000,
				outputTokens: 50000,
			},
		],
		byModel: [{ model: "gemini-2.5-flash", calls: 340, costUsd: 12.3456 }],
		byProvider: [{ provider: "google", calls: 340, costUsd: 12.3456 }],
		dailySpend: [{ date: "2026-08-15", costUsd: 2.1, calls: 40 }],
		costPerAnalyzedSong: 0.0425,
		costPerActivatedAccount: 0.4409,
		costPerPaidAccount: 2.4691,
		activeSubscriptions: 8,
		newPaidActivations: 5,
		previousPaidActivations: 2,
	},
	sources: availableSources,
	caveats: [],
};

const mockCoverage = {
	generatedAt: "2026-08-16T12:00:00Z",
	range,
	data: {
		rows: [
			{
				id: "purchase_confirmed",
				name: "Billing activation",
				canonicalSource: "Supabase billing_activation",
				posthogEventName: "legacy purchase_confirmed",
				dbCount: 5,
				posthogCount: 4,
				dbDistinctAccounts: 5,
				posthogDistinctAccounts: 4,
				coveragePercent: 80.0,
				dbLatestTimestamp: "2026-08-16T11:00:00Z",
				posthogLatestTimestamp: "2026-08-16T10:55:00Z",
				isLowVolume: true,
				semanticNote: "Low volume test row",
			},
		],
		freshness: {
			dbLatest: "2026-08-16T11:50:00Z",
			posthogLatest: "2026-08-16T11:45:00Z",
		},
	},
	sources: availableSources,
	caveats: [],
};

vi.mock("../../lib/api", () => ({
	useApi: (path: string) => {
		const byEndpoint: Record<string, unknown> = {
			activity: mockActivity,
			economics: mockEconomics,
			coverage: mockCoverage,
		};
		const endpoint = path.split("?")[0].replace("/api/telemetry/", "");
		return {
			data: byEndpoint[endpoint] ?? null,
			error: null,
			loading: false,
			refetch: vi.fn(),
		};
	},
}));

import { TelemetrySection } from "../TelemetrySection";

function openTab(name: RegExp) {
	render(<TelemetrySection refreshKey={0} />);
	fireEvent.click(screen.getByRole("button", { name }));
}

describe("TelemetrySection UI", () => {
	it("renders unavailable PostHog traffic as '—', never 0", () => {
		openTab(/activity & dau/i);

		const observedCard = screen
			.getByRole("heading", { name: /observed analytics/i })
			.closest(".card") as HTMLElement;
		expect(within(observedCard).getAllByText("—")).toHaveLength(3);
	});

	it("shows both product-audience and all-account LLM spend", () => {
		openTab(/llm economics/i);

		// Both ledger scopes surface: product-audience spend and real all-account spend.
		expect(screen.getAllByText("$12.35").length).toBeGreaterThan(0);
		expect(screen.getByText(/\$15\.68/)).toBeDefined();
	});

	it("formats low-volume coverage as a dimmed percentage instead of a tone badge", () => {
		openTab(/data quality & coverage/i);

		expect(screen.getByText("80% (low vol)")).toBeDefined();
	});
});
