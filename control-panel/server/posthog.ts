/**
 * PostHog read adapter for the control panel.
 *
 * Provides typed, allowlisted read-only access to PostHog analytics data
 * without exposing personal tokens to the browser or allowing arbitrary HogQL queries.
 * Returns better-result Result types with redacted, typed errors.
 */

import { Result, TaggedError } from "better-result";
import { z } from "zod";
import { getPostHogCreds } from "./prod-creds";

const ALLOWED_HOSTS = new Set([
	"https://eu.posthog.com",
	"https://app.posthog.com",
	"https://us.posthog.com",
]);

const REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB limit

export class PostHogConfigError extends TaggedError("PostHogConfigError")<{
	message: string;
}>() {
	constructor(message: string) {
		super({ message });
	}
}

export class PostHogFetchError extends TaggedError("PostHogFetchError")<{
	status?: number;
	message: string;
}>() {
	constructor(message: string, status?: number) {
		super({ message, status });
	}
}

export type PostHogError = PostHogConfigError | PostHogFetchError;

export type SourceStatus =
	| { status: "available"; fetchedAt: string; latestObservedAt: string | null }
	| { status: "quiet"; fetchedAt: string; latestObservedAt: string | null }
	| { status: "unconfigured"; message: string }
	| { status: "unavailable"; message: string };

export interface PostHogActivityData {
	visitors: number;
	pageviews: number;
	sessions: number;
	latestObservedAt: string | null;
}

export interface PostHogRouteUsageItem {
	pathname: string;
	count: number;
}

export interface PostHogEventCoverageData {
	onboardingCompleted: number;
	purchaseConfirmed: number;
	matchSnapshotPublished: number;
	matchDeckAction: number;
	distinctAccounts: {
		onboardingCompleted: number;
		purchaseConfirmed: number;
		matchSnapshotPublished: number;
		matchDeckAction: number;
	};
	latestTimestamps: {
		onboardingCompleted: string | null;
		purchaseConfirmed: string | null;
		matchSnapshotPublished: string | null;
		matchDeckAction: string | null;
	};
}

export interface PostHogEventItem {
	id: string;
	event: string;
	distinctId: string;
	timestamp: string;
	properties?: Record<string, unknown>;
}

const HogQLResponseSchema = z.object({
	results: z.array(z.array(z.unknown())),
	columns: z.array(z.string()).optional(),
	types: z.array(z.unknown()).optional(),
});

const CountSchema = z.number().finite().nonnegative().int();
const NullableTimestampSchema = z.string().min(1).nullable();
const SourceStatusRowsSchema = z.array(
	z.tuple([NullableTimestampSchema]),
);
const ActivityRowsSchema = z.array(
	z.tuple([
		CountSchema,
		CountSchema,
		CountSchema,
		NullableTimestampSchema,
	]),
);
const RouteRowsSchema = z.array(z.tuple([z.string().min(1), CountSchema]));
const CoverageRowsSchema = z.array(
	z.tuple([
		z.enum([
			"onboarding_completed",
			"purchase_confirmed",
			"match_snapshot_published",
			"match_deck_action",
		]),
		CountSchema,
		CountSchema,
		NullableTimestampSchema,
	]),
);
const LatestEventRowsSchema = z.array(
	z.tuple([
		z.string().min(1),
		z.string().min(1),
		z.string().min(1),
		z.string().min(1),
		z.record(z.string(), z.unknown()).nullable(),
	]),
);

// HogQL has no bound parameters here, so only canonical UUIDs reach the query
// text — anything else is dropped rather than quoted into it.
function excludedDistinctIdsClause(excludedAccountIds: readonly string[]): string {
	const ids = excludedAccountIds
		.filter((id) =>
			/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
				id,
			),
		)
		.map((id) => `'${id}'`)
		.join(", ");
	if (!ids) return "";
	return `\n\t\t  AND distinct_id NOT IN (${ids})`;
}

function validateRows<T>(
	schema: z.ZodType<T>,
	rows: unknown,
	queryName: string,
): Result<T, PostHogError> {
	const parsed = schema.safeParse(rows);
	if (parsed.success) return Result.ok(parsed.data);
	return Result.err(
		new PostHogFetchError(
			`Malformed PostHog ${queryName} rows: ${parsed.error.message}`,
		),
	);
}

/**
 * Validates credentials and executes a fixed HogQL query against PostHog EU/US API.
 */
async function executeHogQL(
	hogqlQuery: string,
): Promise<Result<z.infer<typeof HogQLResponseSchema>, PostHogError>> {
	const { apiKey, projectId, apiHost } = getPostHogCreds();

	if (!apiKey) {
		return Result.err(
			new PostHogConfigError(
				"Missing POSTHOG_PERSONAL_API_KEY in environment files.",
			),
		);
	}

	if (!ALLOWED_HOSTS.has(apiHost)) {
		return Result.err(
			new PostHogConfigError(
				`Configured POSTHOG_API_HOST (${apiHost}) is not in allowlist.`,
			),
		);
	}

	if (!/^\d+$/.test(projectId)) {
		return Result.err(
			new PostHogConfigError(
				"Invalid POSTHOG_PROJECT_ID: must be numeric digits.",
			),
		);
	}

	const url = new URL(
		`/api/projects/${encodeURIComponent(projectId)}/query/`,
		apiHost,
	);

	try {
		const res = await fetch(url.toString(), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				Accept: "application/json",
			},
			body: JSON.stringify({
				query: {
					kind: "HogQLQuery",
					query: hogqlQuery,
				},
			}),
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});

		if (!res.ok) {
			return Result.err(
				new PostHogFetchError(
					`PostHog API responded with status ${res.status} ${res.statusText}`,
					res.status,
				),
			);
		}

		const contentLength = res.headers.get("content-length");
		if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) {
			return Result.err(
				new PostHogFetchError(
					`PostHog response size (${contentLength} bytes) exceeds limit (${MAX_RESPONSE_BYTES} bytes).`,
				),
			);
		}

		const text = await res.text();
		if (text.length > MAX_RESPONSE_BYTES) {
			return Result.err(
				new PostHogFetchError(
					`PostHog response body exceeds size limit (${MAX_RESPONSE_BYTES} bytes).`,
				),
			);
		}

		const jsonUnknown = JSON.parse(text);
		const parsed = HogQLResponseSchema.safeParse(jsonUnknown);
		if (!parsed.success) {
			return Result.err(
				new PostHogFetchError(
					`Malformed PostHog query response: ${parsed.error.message}`,
				),
			);
		}

		return Result.ok(parsed.data);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return Result.err(
			new PostHogFetchError(`PostHog request error: ${msg}`),
		);
	}
}

/**
 * Checks connectivity and freshness of the PostHog integration.
 */
export async function postHogSourceStatus(): Promise<SourceStatus> {
	const res = await executeHogQL(
		"SELECT toString(max(timestamp)) FROM events",
	);

	if (res.isErr()) {
		if (res.error instanceof PostHogConfigError) {
			return {
				status: "unconfigured",
				message: res.error.message,
			};
		}
		return {
			status: "unavailable",
			message: res.error.message,
		};
	}

	const rows = validateRows(
		SourceStatusRowsSchema,
		res.value.results,
		"source status",
	);
	if (rows.isErr()) {
		return { status: "unavailable", message: rows.error.message };
	}

	return {
		status: "available",
		fetchedAt: new Date().toISOString(),
		latestObservedAt: rows.value[0]?.[0] ?? null,
	};
}

/**
 * Queries aggregated activity (visitors, pageviews, sessions) for a time range across all events.
 */
export async function postHogActivity(
	fromIso: string,
	toIso: string,
	excludedAccountIds: readonly string[] = [],
): Promise<Result<PostHogActivityData, PostHogError>> {
	const query = `
		SELECT
			count(DISTINCT distinct_id),
			countIf(event = '$pageview'),
			count(DISTINCT properties.$session_id),
			toString(max(timestamp))
		FROM events
		WHERE timestamp >= toDateTime('${fromIso}')
		  AND timestamp < toDateTime('${toIso}')${excludedDistinctIdsClause(excludedAccountIds)}
	`;

	const res = await executeHogQL(query);
	if (res.isErr()) return res;

	const rows = validateRows(ActivityRowsSchema, res.value.results, "activity");
	if (rows.isErr()) return Result.err(rows.error);
	const row = rows.value[0] ?? [0, 0, 0, null];

	return Result.ok({
		visitors: row[0],
		pageviews: row[1],
		sessions: row[2],
		latestObservedAt: row[3],
	});
}

/**
 * Queries most-frequent pathnames visited during the period.
 */
export async function postHogRouteUsage(
	fromIso: string,
	toIso: string,
	excludedAccountIds: readonly string[] = [],
): Promise<Result<PostHogRouteUsageItem[], PostHogError>> {
	const query = `
		SELECT
			coalesce(nullif(properties.$pathname, ''), nullif(path(properties.$current_url), ''), 'unknown') AS pathname,
			count() AS cnt
		FROM events
		WHERE event = '$pageview'
		  AND timestamp >= toDateTime('${fromIso}')
		  AND timestamp < toDateTime('${toIso}')${excludedDistinctIdsClause(excludedAccountIds)}
		GROUP BY pathname
		ORDER BY cnt DESC
		LIMIT 50
	`;

	const res = await executeHogQL(query);
	if (res.isErr()) return res;

	const rows = validateRows(RouteRowsSchema, res.value.results, "route usage");
	if (rows.isErr()) return Result.err(rows.error);

	return Result.ok(
		rows.value.map((row) => ({ pathname: row[0], count: row[1] })),
	);
}

/**
 * Queries behavioral event counts and distinct accounts for reconciliation against Supabase facts.
 */
export async function postHogEventCoverage(
	fromIso: string,
	toIso: string,
	excludedAccountIds: readonly string[] = [],
): Promise<Result<PostHogEventCoverageData, PostHogError>> {
	const query = `
		SELECT
			event,
			count(),
			count(DISTINCT distinct_id),
			toString(max(timestamp))
		FROM events
		WHERE event IN ('onboarding_completed', 'purchase_confirmed', 'match_snapshot_published', 'match_deck_action')
		  AND timestamp >= toDateTime('${fromIso}')
		  AND timestamp < toDateTime('${toIso}')${excludedDistinctIdsClause(excludedAccountIds)}
		GROUP BY event
	`;

	const res = await executeHogQL(query);
	if (res.isErr()) return res;

	const rows = validateRows(
		CoverageRowsSchema,
		res.value.results,
		"event coverage",
	);
	if (rows.isErr()) return Result.err(rows.error);

	const counts = {
		onboardingCompleted: 0,
		purchaseConfirmed: 0,
		matchSnapshotPublished: 0,
		matchDeckAction: 0,
	};

	const distinct = {
		onboardingCompleted: 0,
		purchaseConfirmed: 0,
		matchSnapshotPublished: 0,
		matchDeckAction: 0,
	};

	const latest: {
		onboardingCompleted: string | null;
		purchaseConfirmed: string | null;
		matchSnapshotPublished: string | null;
		matchDeckAction: string | null;
	} = {
		onboardingCompleted: null,
		purchaseConfirmed: null,
		matchSnapshotPublished: null,
		matchDeckAction: null,
	};

	for (const row of rows.value) {
		const [ev, count, distinctCount, ts] = row;

		if (ev === "onboarding_completed") {
			counts.onboardingCompleted = count;
			distinct.onboardingCompleted = distinctCount;
			latest.onboardingCompleted = ts;
		} else if (ev === "purchase_confirmed") {
			counts.purchaseConfirmed = count;
			distinct.purchaseConfirmed = distinctCount;
			latest.purchaseConfirmed = ts;
		} else if (ev === "match_snapshot_published") {
			counts.matchSnapshotPublished = count;
			distinct.matchSnapshotPublished = distinctCount;
			latest.matchSnapshotPublished = ts;
		} else if (ev === "match_deck_action") {
			counts.matchDeckAction = count;
			distinct.matchDeckAction = distinctCount;
			latest.matchDeckAction = ts;
		}
	}

	return Result.ok({
		onboardingCompleted: counts.onboardingCompleted,
		purchaseConfirmed: counts.purchaseConfirmed,
		matchSnapshotPublished: counts.matchSnapshotPublished,
		matchDeckAction: counts.matchDeckAction,
		distinctAccounts: distinct,
		latestTimestamps: latest,
	});
}

/**
 * Fetches recent events for freshness auditing and debugging.
 */
export async function postHogLatestEvents(): Promise<
	Result<PostHogEventItem[], PostHogError>
> {
	const query = `
		SELECT
			uuid,
			event,
			distinct_id,
			toString(timestamp),
			properties
		FROM events
		ORDER BY timestamp DESC
		LIMIT 20
	`;

	const res = await executeHogQL(query);
	if (res.isErr()) return res;

	const rows = validateRows(
		LatestEventRowsSchema,
		res.value.results,
		"latest event",
	);
	if (rows.isErr()) return Result.err(rows.error);

	const items: PostHogEventItem[] = rows.value.map((row) => ({
		id: row[0],
		event: row[1],
		distinctId: row[2],
		timestamp: row[3],
		...(row[4] ? { properties: row[4] } : {}),
	}));

	return Result.ok(items);
}
