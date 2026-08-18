// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mockSummary = {
	generatedAt: "2026-08-16T12:00:00Z",
	range: {
		from: "2026-07-17T12:00:00Z",
		to: "2026-08-16T12:00:00Z",
		timezone: "UTC",
		preset: "30d",
	},
	data: {
		accountsCreated: { current: 42, previous: 30, deltaPercent: 40 },
		activatedAccounts: { current: 28, previous: 20, deltaPercent: 40 },
		current7DayActive: 19,
		engagedMatchingAccounts: { current: 24, previous: 15, deltaPercent: 60 },
		paidAccounts: { current: 5, previous: 2, deltaPercent: 150 },
		llmSpend: {
			currentCostUsd: 12.3456,
			previousCostUsd: 8.9012,
			deltaPercent: 38.7,
		},
	},
	sources: {
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
	},
	caveats: [],
};

const mockFunnel = {
	generatedAt: "2026-08-16T12:00:00Z",
	range: {
		from: "2026-07-17T12:00:00Z",
		to: "2026-08-16T12:00:00Z",
		timezone: "UTC",
		preset: "30d",
	},
	data: {
		cohortRange: { from: "2026-07-17T12:00:00Z", to: "2026-08-16T12:00:00Z" },
		totalSignups: 42,
		hasSufficientData: true,
		stages: [
			{
				stageId: "account_created",
				name: "Account created",
				count: 42,
				conversionFromPrevious: 100,
				conversionFromSignup: 100,
				medianSeconds: null,
				p75Seconds: null,
				stuckCount: 2,
			},
			{
				stageId: "spotify_connected",
				name: "Spotify connected",
				count: 40,
				conversionFromPrevious: 95.2,
				conversionFromSignup: 95.2,
				medianSeconds: null,
				p75Seconds: null,
				stuckCount: 5,
				limitationNote: "Eventual state; timestamp not tracked.",
			},
			{
				stageId: "library_synced",
				name: "Library synced",
				count: 35,
				conversionFromPrevious: 87.5,
				conversionFromSignup: 83.3,
				medianSeconds: 120,
				p75Seconds: 240,
				stuckCount: 7,
			},
			{
				stageId: "onboarding_completed",
				name: "Onboarding completed",
				count: 28,
				conversionFromPrevious: 80,
				conversionFromSignup: 66.7,
				medianSeconds: 300,
				p75Seconds: 600,
				stuckCount: 4,
			},
			{
				stageId: "matches_available",
				name: "Matches available",
				count: 24,
				conversionFromPrevious: 85.7,
				conversionFromSignup: 57.1,
				medianSeconds: 400,
				p75Seconds: 800,
				stuckCount: 0,
			},
			{
				stageId: "match_engaged",
				name: "Match engaged",
				count: 24,
				conversionFromPrevious: 100,
				conversionFromSignup: 57.1,
				medianSeconds: 500,
				p75Seconds: 900,
				stuckCount: 2,
			},
			{
				stageId: "first_value",
				name: "First song added",
				count: 22,
				conversionFromPrevious: 91.7,
				conversionFromSignup: 52.4,
				medianSeconds: 600,
				p75Seconds: 1000,
				stuckCount: 17,
			},
			{
				stageId: "paid",
				name: "Paid activation",
				count: 5,
				conversionFromPrevious: 22.7,
				conversionFromSignup: 11.9,
				medianSeconds: 3600,
				p75Seconds: 7200,
				stuckCount: 0,
			},
		],
	},
	sources: mockSummary.sources,
	caveats: [],
};

const mockActivity = {
	generatedAt: "2026-08-16T12:00:00Z",
	range: {
		from: "2026-07-17T12:00:00Z",
		to: "2026-08-16T12:00:00Z",
		timezone: "UTC",
		preset: "30d",
	},
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
		supabase: mockSummary.sources.supabase,
		posthog: {
			status: "unavailable",
			message: "PostHog API unreachable",
		},
	},
	caveats: ["PostHog API is unavailable; showing database facts only."],
};

const mockEngagement = {
	generatedAt: "2026-08-16T12:00:00Z",
	range: {
		from: "2026-07-17T12:00:00Z",
		to: "2026-08-16T12:00:00Z",
		timezone: "UTC",
		preset: "30d",
	},
	data: {
		sessionsStarted: 40,
		sessionsCompleted: 32,
		suggestionsServed: 680,
		added: 450,
		dismissed: 150,
		skipped: 80,
		totalDecisions: 600,
		engagedAccounts: 24,
		matchSessions: 32,
		explicitDecisionAddRate: 75.0,
		servedAddRate: 66.2,
		decisionsPerAccount: 25.0,
		orientationSplit: { song: 400, playlist: 280 },
		timeToFirstDecisionSeconds: 45,
		timeToFirstAddSeconds: 70,
	},
	sources: mockSummary.sources,
	caveats: [],
};

const mockEconomics = {
	generatedAt: "2026-08-16T12:00:00Z",
	range: {
		from: "2026-07-17T12:00:00Z",
		to: "2026-08-16T12:00:00Z",
		timezone: "UTC",
		preset: "30d",
	},
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
	sources: mockSummary.sources,
	caveats: [],
};

const mockCoverage = {
	generatedAt: "2026-08-16T12:00:00Z",
	range: {
		from: "2026-07-17T12:00:00Z",
		to: "2026-08-16T12:00:00Z",
		timezone: "UTC",
		preset: "30d",
	},
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
	sources: mockSummary.sources,
	caveats: [],
};

vi.mock("../../lib/api", () => ({
	useApi: (path: string) => {
		if (path.startsWith("/api/telemetry/summary"))
			return {
				data: mockSummary,
				error: null,
				loading: false,
				refetch: vi.fn(),
			};
		if (path.startsWith("/api/telemetry/funnel"))
			return {
				data: mockFunnel,
				error: null,
				loading: false,
				refetch: vi.fn(),
			};
		if (path.startsWith("/api/telemetry/activity"))
			return {
				data: mockActivity,
				error: null,
				loading: false,
				refetch: vi.fn(),
			};
		if (path.startsWith("/api/telemetry/engagement"))
			return {
				data: mockEngagement,
				error: null,
				loading: false,
				refetch: vi.fn(),
			};
		if (path.startsWith("/api/telemetry/economics"))
			return {
				data: mockEconomics,
				error: null,
				loading: false,
				refetch: vi.fn(),
			};
		if (path.startsWith("/api/telemetry/coverage"))
			return {
				data: mockCoverage,
				error: null,
				loading: false,
				refetch: vi.fn(),
			};
		return { data: null, error: null, loading: false, refetch: vi.fn() };
	},
}));

import { TelemetrySection } from "../TelemetrySection";

describe("TelemetrySection UI", () => {
	it("renders header, source status pills, and summary cards", () => {
		render(<TelemetrySection refreshKey={0} />);

		expect(screen.getByText("Product Telemetry & Observability")).toBeDefined();
		expect(screen.getByText("● Supabase: Available")).toBeDefined();
		expect(screen.getByText("● PostHog: Available")).toBeDefined();
		expect(screen.getByText("Accounts Created")).toBeDefined();
		expect(screen.getByText("Activated Accounts")).toBeDefined();
		expect(screen.getByText("7-Day Active Accounts (WAU)")).toBeDefined();
	});

	it("switches to Canonical Funnel tab and renders milestone stages with limitation note", () => {
		render(<TelemetrySection refreshKey={0} />);

		const funnelTabBtn = screen.getByText("Canonical Funnel");
		fireEvent.click(funnelTabBtn);

		expect(screen.getByText("Cohort Milestone Progression")).toBeDefined();
		expect(screen.getByText("Spotify connected")).toBeDefined();
		expect(screen.getByText("Library synced")).toBeDefined();
		expect(screen.getByText("First song added")).toBeDefined();
		expect(
			screen.getByText("(Eventual state; timestamp not tracked.)"),
		).toBeDefined();
	});

	it("switches to Activity & DAU tab, renders unavailable PostHog as '—' and immature retention as '—'", () => {
		render(<TelemetrySection refreshKey={0} />);

		const activityTabBtn = screen.getByText("Activity & DAU");
		fireEvent.click(activityTabBtn);

		expect(screen.getByText("Canonical Active Accounts")).toBeDefined();
		expect(screen.getByText("24-Hour Active")).toBeDefined();
		expect(
			screen.getByText("Observed Analytics Traffic (PostHog)"),
		).toBeDefined();
		expect(
			screen.getByText("Daily Active Accounts (DAU History)"),
		).toBeDefined();
		expect(screen.getByText("Signup Cohorts Retention")).toBeDefined();

		// Check unavailable PostHog displays dashes, not 0
		const dashes = screen.getAllByText("—");
		expect(dashes.length).toBeGreaterThan(0);
	});

	it("switches to Matching Engagement tab and shows session & add rate metrics", () => {
		render(<TelemetrySection refreshKey={0} />);

		const engagementTabBtn = screen.getByText("Matching Engagement");
		fireEvent.click(engagementTabBtn);

		expect(screen.getByText("Sessions Started")).toBeDefined();
		expect(screen.getByText("Sessions Completed")).toBeDefined();
		expect(screen.getByText("Suggestions Served")).toBeDefined();
		expect(screen.getByText("Total Decisions")).toBeDefined();
		expect(screen.getByText("Songs Added")).toBeDefined();
		expect(screen.getByText("Songs Dismissed")).toBeDefined();
	});

	it("switches to LLM Economics tab and renders provider breakdown", () => {
		render(<TelemetrySection refreshKey={0} />);

		const economicsTabBtn = screen.getByText("LLM Economics");
		fireEvent.click(economicsTabBtn);

		// Both ledger scopes surface: product-audience spend and real all-account spend.
		expect(screen.getAllByText("$12.35").length).toBeGreaterThan(0);
		expect(screen.getByText(/\$15\.68/)).toBeDefined();
		expect(screen.getByText("LLM Spend by Provider")).toBeDefined();
		expect(screen.getByText("LLM Spend by Function")).toBeDefined();
		expect(screen.getByText("LLM Spend by Model")).toBeDefined();
	});

	it("switches to Data Quality & Coverage tab and renders low-volume badge correctly", () => {
		render(<TelemetrySection refreshKey={0} />);

		const coverageTabBtn = screen.getByText("Data Quality & Coverage");
		fireEvent.click(coverageTabBtn);

		expect(screen.getByText("Source Freshness & Latency")).toBeDefined();
		expect(screen.getByText("Event Parity & Reconciliation")).toBeDefined();
		expect(screen.getByText("80% (low vol)")).toBeDefined();
	});
});
