/**
 * Telemetry report composer for the control panel.
 *
 * Combines canonical database facts and behavioral PostHog analytics into
 * UI-ready responses with standard metadata, source statuses, and explicit caveats.
 */

import { cached } from "./cache";
import {
	PostHogConfigError,
	type SourceStatus,
} from "./posthog";
import {
	type ActivityReport,
	type EconomicsReport,
	type EngagementReport,
	type FunnelCohortReport,
	getCoverageDbMetrics,
	getDbSourceStatus,
	getEconomicsMetrics,
	getEngagementMetrics,
	getFunnelCohort,
	getActivityMetrics,
	parseTelemetryRange,
} from "./telemetry-db";
import {
	getCachedPostHogActivity,
	getCachedPostHogEventCoverage,
	getCachedPostHogRouteUsage,
	getCachedPostHogSourceStatus,
} from "./telemetry-posthog";

const DB_REPORT_CACHE_TTL = 30_000; // 30 seconds

export interface TelemetryResponse<T> {
	generatedAt: string;
	range: {
		from: string;
		to: string;
		timezone: "UTC";
		preset: string;
	};
	data: T;
	sources: {
		supabase: SourceStatus;
		posthog: SourceStatus;
	};
	caveats: string[];
}

export interface TelemetrySourcesData {
	supabase: SourceStatus;
	posthog: SourceStatus;
}

export interface TelemetrySummaryData {
	accountsCreated: {
		current: number;
		previous: number;
		deltaPercent: number | null;
	};
	activatedAccounts: {
		current: number;
		previous: number;
		deltaPercent: number | null;
	};
	current7DayActive: number;
	engagedMatchingAccounts: {
		current: number;
		previous: number;
		deltaPercent: number | null;
	};
	paidAccounts: {
		current: number;
		previous: number;
		deltaPercent: number | null;
	};
	llmSpend: {
		currentCostUsd: number;
		previousCostUsd: number;
		deltaPercent: number | null;
	};
}

export interface TelemetryActivityData extends ActivityReport {
	observedWebActivity: {
		visitors: number | null;
		pageviews: number | null;
		sessions: number | null;
		latestObservedAt: string | null;
	};
	routeUsage: { pathname: string; count: number }[];
}

export interface EventCoverageRow {
	id: string;
	name: string;
	canonicalSource: string;
	posthogEventName: string;
	dbCount: number;
	posthogCount: number | null;
	dbDistinctAccounts: number;
	posthogDistinctAccounts: number | null;
	coveragePercent: number | null;
	dbLatestTimestamp: string | null;
	posthogLatestTimestamp: string | null;
	isLowVolume: boolean;
	semanticNote: string;
}

export interface TelemetryCoverageData {
	rows: EventCoverageRow[];
	freshness: {
		dbLatest: string | null;
		posthogLatest: string | null;
	};
}

/** Resolves baseline source statuses with quiet / unavailable logic. */
async function resolveSources(fresh = false): Promise<{
	supabase: SourceStatus;
	posthog: SourceStatus;
}> {
	const [dbStatus, phStatus] = await Promise.all([
		getDbSourceStatus(),
		getCachedPostHogSourceStatus(fresh),
	]);

	let posthog: SourceStatus = phStatus;
	if (
		phStatus.status === "available" &&
		dbStatus.status === "available" &&
		dbStatus.latestObservedAt
	) {
		const dbTime = new Date(dbStatus.latestObservedAt).getTime();
		if (phStatus.latestObservedAt) {
			const phTime = new Date(phStatus.latestObservedAt).getTime();
			// If DB activity has occurred more recently than 2 hours and PostHog is older
			if (dbTime - phTime > 2 * 3600 * 1000) {
				posthog = {
					status: "quiet",
					fetchedAt: phStatus.fetchedAt,
					latestObservedAt: phStatus.latestObservedAt,
				};
			}
		} else {
			// PostHog returned 0 events while Supabase has activity
			posthog = {
				status: "quiet",
				fetchedAt: phStatus.fetchedAt,
				latestObservedAt: null,
			};
		}
	}

	return { supabase: dbStatus, posthog };
}

/** Wraps payload into standard envelope with status metadata and caveats. */
function wrapResponse<T>(
	data: T,
	preset: string,
	fromIso: string,
	toIso: string,
	sources: { supabase: SourceStatus; posthog: SourceStatus },
	caveats: string[] = [],
): TelemetryResponse<T> {
	const allCaveats = [...caveats];
	if (sources.posthog.status === "unconfigured") {
		allCaveats.push(
			"PostHog is unconfigured; client behavioral telemetry is omitted.",
		);
	} else if (sources.posthog.status === "unavailable") {
		allCaveats.push(
			`PostHog API is unavailable (${sources.posthog.message}); showing database facts only.`,
		);
	} else if (sources.posthog.status === "quiet") {
		allCaveats.push(
			"PostHog traffic is quiet compared to latest database activity.",
		);
	}

	return {
		generatedAt: new Date().toISOString(),
		range: {
			from: fromIso,
			to: toIso,
			timezone: "UTC",
			preset,
		},
		data,
		sources,
		caveats: allCaveats,
	};
}

export async function getTelemetrySources(
	fresh = false,
): Promise<TelemetrySourcesData> {
	return resolveSources(fresh);
}

export async function getTelemetrySummary(
	preset = "30d",
	fresh = false,
): Promise<TelemetryResponse<TelemetrySummaryData>> {
	const parsed = parseTelemetryRange(preset);
	const sources = await resolveSources(fresh);

	const data = await cached(
		`telemetry:report:summary:${parsed.preset}:${parsed.toIso}`,
		async () => {
			const [funnelCurr, funnelPrev, actCurr, engCurr, engPrev, econCurr] =
				await Promise.all([
					getFunnelCohort(parsed),
					getFunnelCohort({
						...parsed,
						from: parsed.previousFrom,
						to: parsed.previousTo,
						fromIso: parsed.previousFrom.toISOString(),
						toIso: parsed.previousTo.toISOString(),
					}),
					getActivityMetrics(parsed),
					getEngagementMetrics(parsed),
					getEngagementMetrics({
						...parsed,
						from: parsed.previousFrom,
						to: parsed.previousTo,
						fromIso: parsed.previousFrom.toISOString(),
						toIso: parsed.previousTo.toISOString(),
					}),
					getEconomicsMetrics(parsed),
				]);

			const calcDelta = (curr: number, prev: number) => {
				if (prev <= 0) return null;
				return Math.round(((curr - prev) / prev) * 1000) / 10;
			};

			const currSignups = funnelCurr.totalSignups;
			const prevSignups = funnelPrev.totalSignups;

			const currActivated =
				funnelCurr.stages.find((s) => s.stageId === "onboarding_completed")
					?.count ?? 0;
			const prevActivated =
				funnelPrev.stages.find((s) => s.stageId === "onboarding_completed")
					?.count ?? 0;

			const currEngaged = engCurr.engagedAccounts;
			const prevEngaged = engPrev.engagedAccounts;

			const currPaid = econCurr.newPaidActivations;
			const prevPaid = econCurr.previousPaidActivations;

			return {
				accountsCreated: {
					current: currSignups,
					previous: prevSignups,
					deltaPercent: calcDelta(currSignups, prevSignups),
				},
				activatedAccounts: {
					current: currActivated,
					previous: prevActivated,
					deltaPercent: calcDelta(currActivated, prevActivated),
				},
				current7DayActive: actCurr.currentWau,
				engagedMatchingAccounts: {
					current: currEngaged,
					previous: prevEngaged,
					deltaPercent: calcDelta(currEngaged, prevEngaged),
				},
				paidAccounts: {
					current: currPaid,
					previous: prevPaid,
					deltaPercent: calcDelta(currPaid, prevPaid),
				},
				llmSpend: {
					currentCostUsd: econCurr.totalCostUsd,
					previousCostUsd: econCurr.previousPeriodCostUsd,
					deltaPercent: econCurr.costDeltaPercent,
				},
			};
		},
		fresh,
		DB_REPORT_CACHE_TTL,
	);

	return wrapResponse(
		data,
		parsed.preset,
		parsed.fromIso,
		parsed.toIso,
		sources,
	);
}

export async function getTelemetryFunnel(
	preset = "30d",
	fresh = false,
): Promise<TelemetryResponse<FunnelCohortReport>> {
	const parsed = parseTelemetryRange(preset);
	const sources = await resolveSources(fresh);

	const data = await cached(
		`telemetry:report:funnel:${parsed.preset}:${parsed.toIso}`,
		() => getFunnelCohort(parsed),
		fresh,
		DB_REPORT_CACHE_TTL,
	);

	const caveats: string[] = [];
	if (!data.hasSufficientData) {
		caveats.push(
			`Cohort contains ${data.totalSignups} accounts (< 10 threshold). Conversion percentages are withheld as insufficient data.`,
		);
	}

	return wrapResponse(
		data,
		parsed.preset,
		parsed.fromIso,
		parsed.toIso,
		sources,
		caveats,
	);
}

export async function getTelemetryActivity(
	preset = "30d",
	fresh = false,
): Promise<TelemetryResponse<TelemetryActivityData>> {
	const parsed = parseTelemetryRange(preset);
	const sources = await resolveSources(fresh);

	const [dbActivity, phActivityRes, phRoutesRes] = await Promise.all([
		cached(
			`telemetry:report:activity_db:${parsed.preset}:${parsed.toIso}`,
			() => getActivityMetrics(parsed),
			fresh,
			DB_REPORT_CACHE_TTL,
		),
		getCachedPostHogActivity(
			parsed.preset,
			parsed.fromIso,
			parsed.toIso,
			fresh,
		),
		getCachedPostHogRouteUsage(
			parsed.preset,
			parsed.fromIso,
			parsed.toIso,
			fresh,
		),
	]);

	let effectivePostHogStatus = sources.posthog;
	const failedPostHogQuery = phActivityRes.isErr()
		? phActivityRes.error
		: phRoutesRes.isErr()
			? phRoutesRes.error
			: null;
	if (failedPostHogQuery) {
		if (failedPostHogQuery instanceof PostHogConfigError) {
			effectivePostHogStatus = {
				status: "unconfigured",
				message: failedPostHogQuery.message,
			};
		} else {
			effectivePostHogStatus = {
				status: "unavailable",
				message: failedPostHogQuery.message,
			};
		}
	}

	const observedWebActivity = phActivityRes.isOk()
		? {
				visitors: phActivityRes.value.visitors,
				pageviews: phActivityRes.value.pageviews,
				sessions: phActivityRes.value.sessions,
				latestObservedAt: phActivityRes.value.latestObservedAt,
			}
		: {
				visitors: null,
				pageviews: null,
				sessions: null,
				latestObservedAt: null,
			};

	const routeUsage = phRoutesRes.isOk() ? phRoutesRes.value : [];

	const data: TelemetryActivityData = {
		...dbActivity,
		observedWebActivity,
		routeUsage,
	};

	const caveats = phRoutesRes.isErr()
		? [
				`PostHog route usage query failed (${phRoutesRes.error.message}); route usage is omitted.`,
			]
		: [];

	return wrapResponse(
		data,
		parsed.preset,
		parsed.fromIso,
		parsed.toIso,
		{ supabase: sources.supabase, posthog: effectivePostHogStatus },
		caveats,
	);
}

export async function getTelemetryEngagement(
	preset = "30d",
	fresh = false,
): Promise<TelemetryResponse<EngagementReport>> {
	const parsed = parseTelemetryRange(preset);
	const sources = await resolveSources(fresh);

	const data = await cached(
		`telemetry:report:engagement:${parsed.preset}:${parsed.toIso}`,
		() => getEngagementMetrics(parsed),
		fresh,
		DB_REPORT_CACHE_TTL,
	);

	return wrapResponse(
		data,
		parsed.preset,
		parsed.fromIso,
		parsed.toIso,
		sources,
	);
}

export async function getTelemetryEconomics(
	preset = "30d",
	fresh = false,
): Promise<TelemetryResponse<EconomicsReport>> {
	const parsed = parseTelemetryRange(preset);
	const sources = await resolveSources(fresh);

	const data = await cached(
		`telemetry:report:economics:${parsed.preset}:${parsed.toIso}`,
		() => getEconomicsMetrics(parsed),
		fresh,
		DB_REPORT_CACHE_TTL,
	);

	return wrapResponse(
		data,
		parsed.preset,
		parsed.fromIso,
		parsed.toIso,
		sources,
	);
}

export async function getTelemetryCoverage(
	preset = "30d",
	fresh = false,
): Promise<TelemetryResponse<TelemetryCoverageData>> {
	const parsed = parseTelemetryRange(preset);
	const sources = await resolveSources(fresh);

	const [dbFacts, phCoverageRes] = await Promise.all([
		cached(
			`telemetry:report:coverage_db:${parsed.preset}:${parsed.toIso}`,
			() => getCoverageDbMetrics(parsed),
			fresh,
			DB_REPORT_CACHE_TTL,
		),
		getCachedPostHogEventCoverage(
			parsed.preset,
			parsed.fromIso,
			parsed.toIso,
			fresh,
		),
	]);

	let effectivePostHogStatus = sources.posthog;
	if (phCoverageRes.isErr()) {
		if (phCoverageRes.error instanceof PostHogConfigError) {
			effectivePostHogStatus = {
				status: "unconfigured",
				message: phCoverageRes.error.message,
			};
		} else {
			effectivePostHogStatus = {
				status: "unavailable",
				message: phCoverageRes.error.message,
			};
		}
	}

	const ph = phCoverageRes.isOk() ? phCoverageRes.value : null;

	const makeRow = (
		id: string,
		name: string,
		canonicalSource: string,
		phName: string,
		dbCount: number,
		phCount: number | null,
		dbDistinct: number,
		phDistinct: number | null,
		dbLatest: string | null,
		phLatest: string | null,
		semanticNote: string,
	): EventCoverageRow => {
		const isLowVolume = dbCount < 10;
		const coveragePercent =
			phCount !== null && dbCount > 0
				? Math.round((phCount / dbCount) * 1000) / 10
				: null;

		return {
			id,
			name,
			canonicalSource,
			posthogEventName: phName,
			dbCount,
			posthogCount: phCount,
			dbDistinctAccounts: dbDistinct,
			posthogDistinctAccounts: phDistinct,
			coveragePercent,
			dbLatestTimestamp: dbLatest,
			posthogLatestTimestamp: phLatest,
			isLowVolume,
			semanticNote,
		};
	};

	const rows: EventCoverageRow[] = [
		makeRow(
			"onboarding_completed",
			"Onboarding completed",
			"Supabase user_preferences.onboarding_completed_at",
			"onboarding_completed",
			dbFacts.onboardingCompleted.count,
			ph?.onboardingCompleted ?? null,
			dbFacts.onboardingCompleted.distinctAccounts,
			ph?.distinctAccounts.onboardingCompleted ?? null,
			dbFacts.onboardingCompleted.latestTimestamp,
			ph?.latestTimestamps.onboardingCompleted ?? null,
			"Exact semantic match when client completes onboarding wizard.",
		),
		makeRow(
			"purchase_confirmed",
			"Billing activation",
			"Supabase billing_activation",
			"legacy purchase_confirmed",
			dbFacts.purchaseConfirmed.count,
			ph?.purchaseConfirmed ?? null,
			dbFacts.purchaseConfirmed.distinctAccounts,
			ph?.distinctAccounts.purchaseConfirmed ?? null,
			dbFacts.purchaseConfirmed.latestTimestamp,
			ph?.latestTimestamps.purchaseConfirmed ?? null,
			"purchase_confirmed is a legacy client event; billing_activation is canonical.",
		),
		makeRow(
			"match_snapshot_published",
			"Match snapshot published",
			"Supabase match_snapshot",
			"match_snapshot_published",
			dbFacts.matchSnapshotPublished.count,
			ph?.matchSnapshotPublished ?? null,
			dbFacts.matchSnapshotPublished.distinctAccounts,
			ph?.distinctAccounts.matchSnapshotPublished ?? null,
			dbFacts.matchSnapshotPublished.latestTimestamp,
			ph?.latestTimestamps.matchSnapshotPublished ?? null,
			"Server job produces snapshots; PostHog event captures publication if enabled.",
		),
		makeRow(
			"match_deck_action",
			"Match action persisted",
			"Supabase match_event",
			"match_deck_action",
			dbFacts.matchDeckAction.count,
			ph?.matchDeckAction ?? null,
			dbFacts.matchDeckAction.distinctAccounts,
			ph?.distinctAccounts.matchDeckAction ?? null,
			dbFacts.matchDeckAction.latestTimestamp,
			ph?.latestTimestamps.matchDeckAction ?? null,
			"Emitted on each match swipe/add action.",
		),
	];

	const freshness = {
		dbLatest:
			sources.supabase.status === "available" ||
			sources.supabase.status === "quiet"
				? sources.supabase.latestObservedAt
				: null,
		posthogLatest:
			effectivePostHogStatus.status === "available" ||
			effectivePostHogStatus.status === "quiet"
				? effectivePostHogStatus.latestObservedAt
				: null,
	};

	return wrapResponse(
		{ rows, freshness },
		parsed.preset,
		parsed.fromIso,
		parsed.toIso,
		{ supabase: sources.supabase, posthog: effectivePostHogStatus },
	);
}
