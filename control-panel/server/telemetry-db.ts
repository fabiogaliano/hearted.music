/**
 * Read-only database queries for canonical telemetry metrics.
 *
 * Runs inside read-only Postgres transactions against Supabase prod.
 * Treats database facts as the single source of truth for accounts,
 * funnel progression, engagement actions, billing, and LLM economics.
 */

import { read } from "./db";
import type { SourceStatus } from "./posthog";
import {
	ACTIVITY_HISTORY_COMPLETE_FROM,
	LAUNCH_DATE,
	SUPPORTED_TELEMETRY_PRESETS,
	type TelemetryPreset,
} from "./telemetry-registry";

export interface ParsedTelemetryRange {
	preset: TelemetryPreset;
	from: Date;
	to: Date;
	previousFrom: Date;
	previousTo: Date;
	fromIso: string;
	toIso: string;
}

/**
 * Computes exact percentile (e.g. 0.5 for median, 0.75 for p75) from a sorted array of numbers.
 * Uses linear interpolation between closest ranks.
 */
export function calculatePercentile(
	sortedValues: number[],
	p: number,
): number | null {
	if (sortedValues.length === 0) return null;
	if (sortedValues.length === 1) return sortedValues[0]!;
	if (p <= 0) return sortedValues[0]!;
	if (p >= 1) return sortedValues[sortedValues.length - 1]!;

	const index = (sortedValues.length - 1) * p;
	const lower = Math.floor(index);
	const upper = Math.ceil(index);
	const weight = index - lower;

	if (lower === upper) return sortedValues[lower]!;
	return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}

/**
 * Parses supported preset range values into half-open UTC boundaries [from, to).
 * Throws an error for unsupported presets instead of silently defaulting.
 */
export function parseTelemetryRange(
	presetInput = "30d",
	referenceTime: Date = new Date(),
): ParsedTelemetryRange {
	const preset = presetInput as TelemetryPreset;
	if (!SUPPORTED_TELEMETRY_PRESETS.includes(preset)) {
		throw new RangeError(
			`Invalid telemetry preset "${presetInput}". Supported presets: ${SUPPORTED_TELEMETRY_PRESETS.join(", ")}`,
		);
	}

	const rangeBucketMs = 5 * 60_000;
	const to = new Date(
		Math.floor(referenceTime.getTime() / rangeBucketMs) * rangeBucketMs,
	);
	let from: Date;
	let previousFrom: Date;
	let previousTo: Date;

	switch (preset) {
		case "24h": {
			const durationMs = 24 * 3_600_000;
			from = new Date(to.getTime() - durationMs);
			previousTo = from;
			previousFrom = new Date(previousTo.getTime() - durationMs);
			break;
		}
		case "7d": {
			const durationMs = 7 * 86_400_000;
			from = new Date(to.getTime() - durationMs);
			previousTo = from;
			previousFrom = new Date(previousTo.getTime() - durationMs);
			break;
		}
		case "14d": {
			const durationMs = 14 * 86_400_000;
			from = new Date(to.getTime() - durationMs);
			previousTo = from;
			previousFrom = new Date(previousTo.getTime() - durationMs);
			break;
		}
		case "30d": {
			const durationMs = 30 * 86_400_000;
			from = new Date(to.getTime() - durationMs);
			previousTo = from;
			previousFrom = new Date(previousTo.getTime() - durationMs);
			break;
		}
		case "90d": {
			const durationMs = 90 * 86_400_000;
			from = new Date(to.getTime() - durationMs);
			previousTo = from;
			previousFrom = new Date(previousTo.getTime() - durationMs);
			break;
		}
		case "launch": {
			from = new Date(LAUNCH_DATE);
			const durationMs = to.getTime() - from.getTime();
			previousTo = from;
			previousFrom = new Date(from.getTime() - durationMs);
			break;
		}
	}

	return {
		preset,
		from,
		to,
		previousFrom,
		previousTo,
		fromIso: from.toISOString(),
		toIso: to.toISOString(),
	};
}

/**
 * Checks connectivity and freshness of canonical database tables.
 */
export async function getDbSourceStatus(): Promise<SourceStatus> {
	try {
		const rows = await read<{
			now_utc: string;
			latest_account: string | null;
			latest_activity: string | null;
			latest_match: string | null;
		}>(`
			SELECT
				now()::text AS now_utc,
				(SELECT max(created_at)::text FROM account) AS latest_account,
				(SELECT max(last_seen_at)::text FROM account_activity) AS latest_activity,
				(SELECT max(occurred_at)::text FROM match_event) AS latest_match
		`);

		const row = rows[0];
		if (!row) {
			return {
				status: "unavailable",
				message: "No response from database health query.",
			};
		}

		const timestamps = [
			row.latest_account,
			row.latest_activity,
			row.latest_match,
		].filter((t): t is string => Boolean(t));

		timestamps.sort().reverse();
		const latestObservedAt = timestamps[0] ?? null;

		return {
			status: "available",
			fetchedAt: row.now_utc,
			latestObservedAt,
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			status: "unavailable",
			message: `Database connection error: ${msg}`,
		};
	}
}

export interface FunnelStageMetric {
	stageId: string;
	name: string;
	count: number;
	conversionFromPrevious: number | null;
	conversionFromSignup: number | null;
	medianSeconds: number | null;
	p75Seconds: number | null;
	stuckCount: number;
	limitationNote?: string;
}

export interface FunnelCohortReport {
	cohortRange: { from: string; to: string };
	totalSignups: number;
	hasSufficientData: boolean;
	stages: FunnelStageMetric[];
}

/**
 * Evaluates the 8-stage canonical funnel for the cohort created in [from, to).
 */
export async function getFunnelCohort(
	range: ParsedTelemetryRange,
): Promise<FunnelCohortReport> {
	const rows = await read<{
		id: string;
		created_at: string;
		spotify_id: string | null;
		onboarding_completed_at: string | null;
		first_synced_at: string | null;
		first_snapshot_at: string | null;
		first_event_at: string | null;
		first_add_at: string | null;
		first_paid_at: string | null;
	}>(
		`
		WITH cohort AS (
			SELECT a.id, a.created_at, a.spotify_id, up.onboarding_completed_at
			FROM account a
			LEFT JOIN user_preferences up ON up.account_id = a.id
			WHERE a.created_at >= $1 AND a.created_at < $2
		),
		first_sync AS (
			SELECT account_id, min(completed_at) AS first_synced_at
			FROM job
			WHERE type = 'extension_sync' AND status = 'completed'
			GROUP BY account_id
		),
		first_snapshot AS (
			SELECT account_id, min(created_at) AS first_snapshot_at
			FROM match_snapshot
			GROUP BY account_id
		),
		first_event AS (
			SELECT
				account_id,
				min(occurred_at) AS first_event_at,
				min(occurred_at) FILTER (WHERE event = 'added') AS first_add_at
			FROM match_event
			GROUP BY account_id
		),
		first_paid AS (
			SELECT account_id, min(created_at) AS first_paid_at
			FROM billing_activation
			GROUP BY account_id
		)
		SELECT
			c.id,
			c.created_at::text,
			c.spotify_id,
			c.onboarding_completed_at::text,
			s.first_synced_at::text,
			sn.first_snapshot_at::text,
			e.first_event_at::text,
			e.first_add_at::text,
			p.first_paid_at::text
		FROM cohort c
		LEFT JOIN first_sync s ON s.account_id = c.id
		LEFT JOIN first_snapshot sn ON sn.account_id = c.id
		LEFT JOIN first_event e ON e.account_id = c.id
		LEFT JOIN first_paid p ON p.account_id = c.id
		`,
		[range.fromIso, range.toIso],
	);

	const totalSignups = rows.length;
	const hasSufficientData = totalSignups >= 10;

	// Stage evaluation helpers
	const calculateDurations = (
		timestamps: { created_at: string; milestone_at: string | null }[],
	) => {
		const secondsList: number[] = [];
		for (const t of timestamps) {
			if (t.milestone_at) {
				const diff =
					(new Date(t.milestone_at).getTime() -
						new Date(t.created_at).getTime()) /
					1000;
				if (diff >= 0) secondsList.push(diff);
			}
		}
		if (secondsList.length === 0) {
			return { median: null, p75: null };
		}
		secondsList.sort((a, b) => a - b);
		const median = calculatePercentile(secondsList, 0.5);
		const p75 = calculatePercentile(secondsList, 0.75);
		return { median, p75 };
	};

	// 1. Account created
	const stage1Accounts = rows;
	// 2. Spotify connected (eventual state in cohort, no milestone timestamp)
	const stage2Accounts = rows.filter((r) => r.spotify_id !== null);
	// 3. Library synced
	const stage3Accounts = rows.filter((r) => r.first_synced_at !== null);
	// 4. Onboarding completed
	const stage4Accounts = rows.filter((r) => r.onboarding_completed_at !== null);
	// 5. Matches available
	const stage5Accounts = rows.filter((r) => r.first_snapshot_at !== null);
	// 6. Match engaged
	const stage6Accounts = rows.filter((r) => r.first_event_at !== null);
	// 7. First value (song added)
	const stage7Accounts = rows.filter((r) => r.first_add_at !== null);
	// 8. Paid
	const stage8Accounts = rows.filter((r) => r.first_paid_at !== null);

	const stageGroups = [
		{
			id: "account_created",
			name: "Account created",
			accounts: stage1Accounts,
			ts: () => null,
		},
		{
			id: "spotify_connected",
			name: "Spotify connected",
			accounts: stage2Accounts,
			// Spotify connection has no dedicated historical timestamp; return null
			ts: () => null,
			limitationNote:
				"Eventual state within signup cohort; connection timestamp not tracked.",
		},
		{
			id: "library_synced",
			name: "Library synced",
			accounts: stage3Accounts,
			ts: (r: (typeof rows)[0]) => r.first_synced_at,
		},
		{
			id: "onboarding_completed",
			name: "Onboarding completed",
			accounts: stage4Accounts,
			ts: (r: (typeof rows)[0]) => r.onboarding_completed_at,
		},
		{
			id: "matches_available",
			name: "Matches available",
			accounts: stage5Accounts,
			ts: (r: (typeof rows)[0]) => r.first_snapshot_at,
		},
		{
			id: "match_engaged",
			name: "Match engaged",
			accounts: stage6Accounts,
			ts: (r: (typeof rows)[0]) => r.first_event_at,
		},
		{
			id: "first_value",
			name: "First song added",
			accounts: stage7Accounts,
			ts: (r: (typeof rows)[0]) => r.first_add_at,
		},
		{
			id: "paid",
			name: "Paid activation",
			accounts: stage8Accounts,
			ts: (r: (typeof rows)[0]) => r.first_paid_at,
		},
	];

	const stages: FunnelStageMetric[] = [];
	for (let i = 0; i < stageGroups.length; i++) {
		const current = stageGroups[i]!;
		const previous = i > 0 ? stageGroups[i - 1]! : null;
		const next = i < stageGroups.length - 1 ? stageGroups[i + 1]! : null;

		const count = current.accounts.length;
		const conversionFromPrevious =
			previous && previous.accounts.length > 0
				? (count / previous.accounts.length) * 100
				: i === 0
					? 100
					: null;
		const conversionFromSignup =
			totalSignups > 0 ? (count / totalSignups) * 100 : null;

		const currentSet = new Set(current.accounts.map((a) => a.id));
		const nextSet = next
			? new Set(next.accounts.map((a) => a.id))
			: new Set<string>();
		let stuckCount = 0;
		if (next) {
			for (const id of currentSet) {
				if (!nextSet.has(id)) stuckCount++;
			}
		}

		const durations = calculateDurations(
			current.accounts.map((a) => ({
				created_at: a.created_at,
				milestone_at: current.ts(a),
			})),
		);

		stages.push({
			stageId: current.id,
			name: current.name,
			count,
			conversionFromPrevious:
				hasSufficientData && conversionFromPrevious !== null
					? Math.round(conversionFromPrevious * 10) / 10
					: null,
			conversionFromSignup:
				hasSufficientData && conversionFromSignup !== null
					? Math.round(conversionFromSignup * 10) / 10
					: null,
			medianSeconds:
				durations.median !== null ? Math.round(durations.median) : null,
			p75Seconds: durations.p75 !== null ? Math.round(durations.p75) : null,
			stuckCount,
			...(current.limitationNote
				? { limitationNote: current.limitationNote }
				: {}),
		});
	}

	return {
		cohortRange: { from: range.fromIso, to: range.toIso },
		totalSignups,
		hasSufficientData,
		stages,
	};
}

export interface ActivityReport {
	dailyActive: { date: string; count: number | null; isComplete: boolean }[];
	current24hActive: number;
	currentWau: number;
	currentMau: number;
	cohortRetention: {
		cohortWeek: string;
		signups: number;
		week1Active: number | null;
		week1Rate: number | null;
		week4Active: number | null;
		week4Rate: number | null;
		isWeek1Mature: boolean;
		isWeek4Mature: boolean;
	}[];
}

/**
 * Queries canonical historical activity from account_activity_day and cohort retention.
 */
export async function getActivityMetrics(
	range: ParsedTelemetryRange,
): Promise<ActivityReport> {
	const dailyRows = await read<{ date: string; count: string }>(
		`
		SELECT
			activity_date::text AS date,
			count(DISTINCT account_id)::int AS count
		FROM account_activity_day
		WHERE activity_date >= ($1::timestamptz AT TIME ZONE 'UTC')::date
		  AND activity_date < ($2::timestamptz AT TIME ZONE 'UTC')::date
		GROUP BY activity_date
		ORDER BY activity_date ASC
		`,
		[range.fromIso, range.toIso],
	);

	// Query exact rolling windows from canonical latest heartbeats
	const activeOverview = await read<{
		active_24h: number;
		wau: number;
		mau: number;
	}>(`
		SELECT
			count(*) FILTER (WHERE last_seen_at >= now() - interval '24 hours')::int AS active_24h,
			count(*) FILTER (WHERE last_seen_at >= now() - interval '7 days')::int AS wau,
			count(*) FILTER (WHERE last_seen_at >= now() - interval '30 days')::int AS mau
		FROM account_activity
	`);

	const retentionRows = await read<{
		cohort_week: string;
		cohort_week_start: string;
		signups: number;
		w1_active: number;
		w4_active: number;
	}>(`
		WITH cohorts AS (
			SELECT
				date_trunc('week', created_at AT TIME ZONE 'UTC')::date::text AS cohort_week,
				date_trunc('week', created_at AT TIME ZONE 'UTC')::date AS cohort_week_start,
				id AS account_id,
				created_at
			FROM account
			WHERE created_at >= now() - interval '90 days'
		),
		cohort_sizes AS (
			SELECT cohort_week, cohort_week_start, count(*)::int AS signups
			FROM cohorts
			GROUP BY cohort_week, cohort_week_start
		),
		w1_active AS (
			SELECT c.cohort_week, count(DISTINCT c.account_id)::int AS w1_count
			FROM cohorts c
			JOIN account_activity_day a ON a.account_id = c.account_id
				AND a.activity_date >= (c.created_at + interval '7 days')::date
				AND a.activity_date < (c.created_at + interval '14 days')::date
			GROUP BY c.cohort_week
		),
		w4_active AS (
			SELECT c.cohort_week, count(DISTINCT c.account_id)::int AS w4_count
			FROM cohorts c
			JOIN account_activity_day a ON a.account_id = c.account_id
				AND a.activity_date >= (c.created_at + interval '28 days')::date
				AND a.activity_date < (c.created_at + interval '35 days')::date
			GROUP BY c.cohort_week
		)
		SELECT
			s.cohort_week,
			s.cohort_week_start::text,
			s.signups,
			coalesce(w1.w1_count, 0)::int AS w1_active,
			coalesce(w4.w4_count, 0)::int AS w4_active
		FROM cohort_sizes s
		LEFT JOIN w1_active w1 ON w1.cohort_week = s.cohort_week
		LEFT JOIN w4_active w4 ON w4.cohort_week = s.cohort_week
		ORDER BY s.cohort_week DESC
		LIMIT 10
	`);

	const nowMs = Date.now();
	const completeHistoryBoundaryMs = new Date(
		ACTIVITY_HISTORY_COMPLETE_FROM,
	).getTime();

	const cohortRetention = retentionRows.map((r) => {
		const cohortStartMs = new Date(r.cohort_week_start).getTime();
		const cohortEndMs = cohortStartMs + 7 * 86_400_000;

		// Week 1 requires activity in [created_at + 7d, created_at + 14d).
		// Mature only if now >= cohortEnd + 14d, and complete history requires cohortStart + 7d >= migrationBoundary.
		const isWeek1Mature =
			nowMs >= cohortEndMs + 14 * 86_400_000 &&
			cohortStartMs + 7 * 86_400_000 >= completeHistoryBoundaryMs;

		// Week 4 requires activity in [created_at + 28d, created_at + 35d).
		// Mature only if now >= cohortEnd + 35d, and complete history requires cohortStart + 28d >= migrationBoundary.
		const isWeek4Mature =
			nowMs >= cohortEndMs + 35 * 86_400_000 &&
			cohortStartMs + 28 * 86_400_000 >= completeHistoryBoundaryMs;

		const week1Active = isWeek1Mature ? r.w1_active : null;
		const week4Active = isWeek4Mature ? r.w4_active : null;

		const week1Rate =
			isWeek1Mature && r.signups > 0
				? Math.round((r.w1_active / r.signups) * 1000) / 10
				: null;
		const week4Rate =
			isWeek4Mature && r.signups > 0
				? Math.round((r.w4_active / r.signups) * 1000) / 10
				: null;

		return {
			cohortWeek: r.cohort_week,
			signups: r.signups,
			week1Active,
			week1Rate,
			week4Active,
			week4Rate,
			isWeek1Mature,
			isWeek4Mature,
		};
	});

	const countsByDate = new Map(
		dailyRows.map((row) => [row.date, Number(row.count)]),
	);
	const firstDayMs = Date.UTC(
		range.from.getUTCFullYear(),
		range.from.getUTCMonth(),
		range.from.getUTCDate(),
	);
	const currentDayMs = Date.UTC(
		range.to.getUTCFullYear(),
		range.to.getUTCMonth(),
		range.to.getUTCDate(),
	);
	const dailyActive: ActivityReport["dailyActive"] = [];
	for (
		let dayMs = firstDayMs;
		dayMs < range.to.getTime();
		dayMs += 86_400_000
	) {
		const date = new Date(dayMs).toISOString().slice(0, 10);
		const isComplete =
			dayMs >= completeHistoryBoundaryMs && dayMs < currentDayMs;
		dailyActive.push({
			date,
			count: isComplete ? (countsByDate.get(date) ?? 0) : null,
			isComplete,
		});
	}

	return {
		dailyActive,
		current24hActive: activeOverview[0]?.active_24h ?? 0,
		currentWau: activeOverview[0]?.wau ?? 0,
		currentMau: activeOverview[0]?.mau ?? 0,
		cohortRetention,
	};
}

export interface EngagementReport {
	sessionsStarted: number;
	sessionsCompleted: number;
	suggestionsServed: number;
	added: number;
	dismissed: number;
	skipped: number;
	totalDecisions: number;
	engagedAccounts: number;
	matchSessions: number;
	explicitDecisionAddRate: number | null;
	servedAddRate: number | null;
	decisionsPerAccount: number | null;
	orientationSplit: {
		song: number;
		playlist: number;
	};
	timeToFirstDecisionSeconds: number | null;
	timeToFirstAddSeconds: number | null;
}

/**
 * Queries match deck interaction metrics and add rates from match_event and match_review_session.
 */
export async function getEngagementMetrics(
	range: ParsedTelemetryRange,
): Promise<EngagementReport> {
	const counts = await read<{
		added: number;
		dismissed: number;
		skipped: number;
		engaged_accounts: number;
		match_sessions: number;
		song_orientation_count: number;
		playlist_orientation_count: number;
		sessions_started: number;
		sessions_completed: number;
		suggestions_served: number;
	}>(
		`
		SELECT
			(SELECT count(*) FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2 AND event = 'added')::int AS added,
			(SELECT count(*) FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2 AND event = 'dismissed')::int AS dismissed,
			(SELECT count(*) FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2 AND event = 'skipped')::int AS skipped,
			(SELECT count(DISTINCT account_id) FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2)::int AS engaged_accounts,
			(SELECT count(DISTINCT session_id) FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2)::int AS match_sessions,
			(SELECT count(*) FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2 AND (served_orientation = 'song' OR served_orientation IS NULL))::int AS song_orientation_count,
			(SELECT count(*) FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2 AND served_orientation = 'playlist')::int AS playlist_orientation_count,
			(SELECT count(*) FROM match_review_session WHERE created_at >= $1 AND created_at < $2)::int AS sessions_started,
			(SELECT count(*) FROM match_review_session WHERE status = 'completed' AND completed_at >= $1 AND completed_at < $2)::int AS sessions_completed,
			(SELECT count(*) FROM match_review_item_visible_pair WHERE captured_at >= $1 AND captured_at < $2)::int AS suggestions_served
		`,
		[range.fromIso, range.toIso],
	);

	const row = counts[0] ?? {
		added: 0,
		dismissed: 0,
		skipped: 0,
		engaged_accounts: 0,
		match_sessions: 0,
		song_orientation_count: 0,
		playlist_orientation_count: 0,
		sessions_started: 0,
		sessions_completed: 0,
		suggestions_served: 0,
	};

	const explicitDecisions = row.added + row.dismissed;

	const timingRows = await read<{
		median_snap_to_decision: number | null;
		median_decision_to_add: number | null;
	}>(
		`
		WITH account_firsts AS (
			SELECT
				a.id AS account_id,
				(SELECT min(created_at) FROM match_snapshot WHERE account_id = a.id) AS first_snap,
				(SELECT min(occurred_at) FROM match_event WHERE account_id = a.id) AS first_dec,
				(SELECT min(occurred_at) FROM match_event WHERE account_id = a.id AND event = 'added') AS first_add
			FROM account a
			WHERE a.created_at >= $1 AND a.created_at < $2
		)
		SELECT
			percentile_cont(0.5) WITHIN GROUP (
				ORDER BY EXTRACT(EPOCH FROM (first_dec - first_snap))
			)::float AS median_snap_to_decision,
			percentile_cont(0.5) WITHIN GROUP (
				ORDER BY EXTRACT(EPOCH FROM (first_add - first_dec))
			)::float AS median_decision_to_add
		FROM account_firsts
		WHERE first_snap IS NOT NULL AND first_dec IS NOT NULL AND first_dec >= first_snap
		`,
		[range.fromIso, range.toIso],
	);

	const timing = timingRows[0];

	return {
		sessionsStarted: row.sessions_started,
		sessionsCompleted: row.sessions_completed,
		suggestionsServed: row.suggestions_served,
		added: row.added,
		dismissed: row.dismissed,
		skipped: row.skipped,
		totalDecisions: explicitDecisions,
		engagedAccounts: row.engaged_accounts,
		matchSessions: row.match_sessions,
		explicitDecisionAddRate:
			explicitDecisions > 0
				? Math.round((row.added / explicitDecisions) * 1000) / 10
				: null,
		servedAddRate:
			row.suggestions_served > 0
				? Math.round((row.added / row.suggestions_served) * 1000) / 10
				: null,
		decisionsPerAccount:
			row.engaged_accounts > 0
				? Math.round((explicitDecisions / row.engaged_accounts) * 10) / 10
				: null,
		orientationSplit: {
			song: row.song_orientation_count,
			playlist: row.playlist_orientation_count,
		},
		timeToFirstDecisionSeconds:
			timing?.median_snap_to_decision !== null &&
			timing?.median_snap_to_decision !== undefined
				? Math.round(timing.median_snap_to_decision)
				: null,
		timeToFirstAddSeconds:
			timing?.median_decision_to_add !== null &&
			timing?.median_decision_to_add !== undefined
				? Math.round(timing.median_decision_to_add)
				: null,
	};
}

export interface EconomicsReport {
	totalCostUsd: number;
	totalCalls: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	previousPeriodCostUsd: number;
	costDeltaPercent: number | null;
	byFunction: {
		functionId: string;
		calls: number;
		costUsd: number;
		inputTokens: number;
		outputTokens: number;
	}[];
	byModel: {
		model: string;
		calls: number;
		costUsd: number;
	}[];
	byProvider: {
		provider: string;
		calls: number;
		costUsd: number;
	}[];
	dailySpend: {
		date: string;
		costUsd: number;
		calls: number;
	}[];
	costPerAnalyzedSong: number | null;
	costPerActivatedAccount: number | null;
	costPerPaidAccount: number | null;
	activeSubscriptions: number;
	newPaidActivations: number;
	previousPaidActivations: number;
}

/**
 * Queries LLM usage ledger and unit economics.
 */
export async function getEconomicsMetrics(
	range: ParsedTelemetryRange,
): Promise<EconomicsReport> {
	const currentLedger = await read<{
		total_cost_usd: number;
		total_calls: number;
		total_input_tokens: number;
		total_output_tokens: number;
	}>(
		`
		SELECT
			coalesce(sum(cost_usd), 0)::float AS total_cost_usd,
			count(*)::int AS total_calls,
			coalesce(sum(input_tokens), 0)::bigint AS total_input_tokens,
			coalesce(sum(output_tokens), 0)::bigint AS total_output_tokens
		FROM llm_usage
		WHERE created_at >= $1 AND created_at < $2
		`,
		[range.fromIso, range.toIso],
	);

	const prevLedger = await read<{ total_cost_usd: number }>(
		`
		SELECT coalesce(sum(cost_usd), 0)::float AS total_cost_usd
		FROM llm_usage
		WHERE created_at >= $1 AND created_at < $2
		`,
		[range.previousFrom.toISOString(), range.previousTo.toISOString()],
	);

	const currentCost = currentLedger[0]?.total_cost_usd ?? 0;
	const prevCost = prevLedger[0]?.total_cost_usd ?? 0;
	let costDeltaPercent: number | null = null;
	if (prevCost > 0) {
		costDeltaPercent =
			Math.round(((currentCost - prevCost) / prevCost) * 1000) / 10;
	}

	const byFunction = await read<{
		function_id: string;
		calls: number;
		cost_usd: number;
		input_tokens: number;
		output_tokens: number;
	}>(
		`
		SELECT
			function_id,
			count(*)::int AS calls,
			coalesce(sum(cost_usd), 0)::float AS cost_usd,
			coalesce(sum(input_tokens), 0)::bigint AS input_tokens,
			coalesce(sum(output_tokens), 0)::bigint AS output_tokens
		FROM llm_usage
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY function_id
		ORDER BY cost_usd DESC
		`,
		[range.fromIso, range.toIso],
	);

	const byModel = await read<{
		model: string;
		calls: number;
		cost_usd: number;
	}>(
		`
		SELECT
			model,
			count(*)::int AS calls,
			coalesce(sum(cost_usd), 0)::float AS cost_usd
		FROM llm_usage
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY model
		ORDER BY cost_usd DESC
		`,
		[range.fromIso, range.toIso],
	);

	const byProvider = await read<{
		provider: string;
		calls: number;
		cost_usd: number;
	}>(
		`
		SELECT
			provider,
			count(*)::int AS calls,
			coalesce(sum(cost_usd), 0)::float AS cost_usd
		FROM llm_usage
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY provider
		ORDER BY cost_usd DESC
		`,
		[range.fromIso, range.toIso],
	);

	const dailySpend = await read<{
		date: string;
		cost_usd: number;
		calls: number;
	}>(
		`
		SELECT
			(created_at AT TIME ZONE 'UTC')::date::text AS date,
			coalesce(sum(cost_usd), 0)::float AS cost_usd,
			count(*)::int AS calls
		FROM llm_usage
		WHERE created_at >= $1 AND created_at < $2
		GROUP BY (created_at AT TIME ZONE 'UTC')::date
		ORDER BY date ASC
		`,
		[range.fromIso, range.toIso],
	);

	const unitCounts = await read<{
		analyzed_songs: number;
		activated_accounts: number;
		paid_accounts: number;
		active_subscriptions: number;
		new_activations: number;
		prev_activations: number;
		song_analysis_cost_usd: number;
	}>(
		`
		SELECT
			(SELECT count(DISTINCT song_id) FROM song_analysis WHERE created_at >= $1 AND created_at < $2)::int AS analyzed_songs,
			(SELECT count(*) FROM user_preferences WHERE onboarding_completed_at >= $1 AND onboarding_completed_at < $2)::int AS activated_accounts,
			(SELECT count(DISTINCT account_id) FROM billing_activation WHERE created_at >= $1 AND created_at < $2)::int AS paid_accounts,
			(SELECT count(*) FROM account_billing WHERE subscription_status = 'active')::int AS active_subscriptions,
			(SELECT count(*) FROM billing_activation WHERE created_at >= $1 AND created_at < $2)::int AS new_activations,
			(SELECT count(*) FROM billing_activation WHERE created_at >= $3 AND created_at < $4)::int AS prev_activations,
			(SELECT coalesce(sum(cost_usd), 0)::float FROM llm_usage
			 WHERE created_at >= $1 AND created_at < $2
			   AND function_id IN ('song-analysis', 'song-rewrite', 'voice-audit-rewrite-pass')) AS song_analysis_cost_usd
		`,
		[
			range.fromIso,
			range.toIso,
			range.previousFrom.toISOString(),
			range.previousTo.toISOString(),
		],
	);

	const u = unitCounts[0] ?? {
		analyzed_songs: 0,
		activated_accounts: 0,
		paid_accounts: 0,
		active_subscriptions: 0,
		new_activations: 0,
		prev_activations: 0,
		song_analysis_cost_usd: 0,
	};

	return {
		totalCostUsd: Math.round(currentCost * 10000) / 10000,
		totalCalls: currentLedger[0]?.total_calls ?? 0,
		totalInputTokens: Number(currentLedger[0]?.total_input_tokens ?? 0),
		totalOutputTokens: Number(currentLedger[0]?.total_output_tokens ?? 0),
		previousPeriodCostUsd: Math.round(prevCost * 10000) / 10000,
		costDeltaPercent,
		byFunction: byFunction.map((f) => ({
			functionId: f.function_id,
			calls: f.calls,
			costUsd: Math.round(f.cost_usd * 10000) / 10000,
			inputTokens: Number(f.input_tokens),
			outputTokens: Number(f.output_tokens),
		})),
		byModel: byModel.map((m) => ({
			model: m.model,
			calls: m.calls,
			costUsd: Math.round(m.cost_usd * 10000) / 10000,
		})),
		byProvider: byProvider.map((p) => ({
			provider: p.provider,
			calls: p.calls,
			costUsd: Math.round(p.cost_usd * 10000) / 10000,
		})),
		dailySpend: dailySpend.map((d) => ({
			date: d.date,
			costUsd: Math.round(d.cost_usd * 10000) / 10000,
			calls: d.calls,
		})),
		costPerAnalyzedSong:
			u.analyzed_songs > 0
				? Math.round((u.song_analysis_cost_usd / u.analyzed_songs) * 10000) /
					10000
				: null,
		costPerActivatedAccount:
			u.activated_accounts > 0
				? Math.round((currentCost / u.activated_accounts) * 10000) / 10000
				: null,
		costPerPaidAccount:
			u.paid_accounts > 0
				? Math.round((currentCost / u.paid_accounts) * 10000) / 10000
				: null,
		activeSubscriptions: u.active_subscriptions,
		newPaidActivations: u.new_activations,
		previousPaidActivations: u.prev_activations,
	};
}

export interface CoverageDbFacts {
	onboardingCompleted: {
		count: number;
		distinctAccounts: number;
		latestTimestamp: string | null;
	};
	purchaseConfirmed: {
		count: number;
		distinctAccounts: number;
		latestTimestamp: string | null;
	};
	matchSnapshotPublished: {
		count: number;
		distinctAccounts: number;
		latestTimestamp: string | null;
	};
	matchDeckAction: {
		count: number;
		distinctAccounts: number;
		latestTimestamp: string | null;
	};
}

/**
 * Queries database facts for reconciliation against behavioral PostHog events.
 */
export async function getCoverageDbMetrics(
	range: ParsedTelemetryRange,
): Promise<CoverageDbFacts> {
	const rows = await read<{
		db_onboarding_completed: number;
		db_onboarding_accounts: number;
		db_onboarding_latest: string | null;
		db_purchase_confirmed: number;
		db_purchase_accounts: number;
		db_purchase_latest: string | null;
		db_snapshot_published: number;
		db_snapshot_accounts: number;
		db_snapshot_latest: string | null;
		db_match_action: number;
		db_match_accounts: number;
		db_match_latest: string | null;
	}>(
		`
		SELECT
			(SELECT count(*) FROM user_preferences WHERE onboarding_completed_at >= $1 AND onboarding_completed_at < $2)::int AS db_onboarding_completed,
			(SELECT count(DISTINCT account_id) FROM user_preferences WHERE onboarding_completed_at >= $1 AND onboarding_completed_at < $2)::int AS db_onboarding_accounts,
			(SELECT max(onboarding_completed_at)::text FROM user_preferences WHERE onboarding_completed_at >= $1 AND onboarding_completed_at < $2) AS db_onboarding_latest,

			(SELECT count(*) FROM billing_activation WHERE created_at >= $1 AND created_at < $2)::int AS db_purchase_confirmed,
			(SELECT count(DISTINCT account_id) FROM billing_activation WHERE created_at >= $1 AND created_at < $2)::int AS db_purchase_accounts,
			(SELECT max(created_at)::text FROM billing_activation WHERE created_at >= $1 AND created_at < $2) AS db_purchase_latest,

			(SELECT count(*) FROM match_snapshot WHERE created_at >= $1 AND created_at < $2)::int AS db_snapshot_published,
			(SELECT count(DISTINCT account_id) FROM match_snapshot WHERE created_at >= $1 AND created_at < $2)::int AS db_snapshot_accounts,
			(SELECT max(created_at)::text FROM match_snapshot WHERE created_at >= $1 AND created_at < $2) AS db_snapshot_latest,

			(SELECT count(*) FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2)::int AS db_match_action,
			(SELECT count(DISTINCT account_id) FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2)::int AS db_match_accounts,
			(SELECT max(occurred_at)::text FROM match_event WHERE occurred_at >= $1 AND occurred_at < $2) AS db_match_latest
		`,
		[range.fromIso, range.toIso],
	);

	const r = rows[0] ?? {
		db_onboarding_completed: 0,
		db_onboarding_accounts: 0,
		db_onboarding_latest: null,
		db_purchase_confirmed: 0,
		db_purchase_accounts: 0,
		db_purchase_latest: null,
		db_snapshot_published: 0,
		db_snapshot_accounts: 0,
		db_snapshot_latest: null,
		db_match_action: 0,
		db_match_accounts: 0,
		db_match_latest: null,
	};

	return {
		onboardingCompleted: {
			count: r.db_onboarding_completed,
			distinctAccounts: r.db_onboarding_accounts,
			latestTimestamp: r.db_onboarding_latest,
		},
		purchaseConfirmed: {
			count: r.db_purchase_confirmed,
			distinctAccounts: r.db_purchase_accounts,
			latestTimestamp: r.db_purchase_latest,
		},
		matchSnapshotPublished: {
			count: r.db_snapshot_published,
			distinctAccounts: r.db_snapshot_accounts,
			latestTimestamp: r.db_snapshot_latest,
		},
		matchDeckAction: {
			count: r.db_match_action,
			distinctAccounts: r.db_match_accounts,
			latestTimestamp: r.db_match_latest,
		},
	};
}
