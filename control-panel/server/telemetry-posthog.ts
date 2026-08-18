/**
 * PostHog telemetry queries with 5-minute caching and in-flight de-duplication.
 */

import type { Result } from "better-result";
import { cached } from "./cache";
import {
	type PostHogActivityData,
	type PostHogError,
	type PostHogEventCoverageData,
	type PostHogEventItem,
	type PostHogRouteUsageItem,
	type SourceStatus,
	postHogActivity,
	postHogEventCoverage,
	postHogLatestEvents,
	postHogRouteUsage,
	postHogSourceStatus,
} from "./posthog";

const POSTHOG_CACHE_TTL = 300_000; // 5 minutes

export async function getCachedPostHogSourceStatus(
	fresh = false,
): Promise<SourceStatus> {
	return cached(
		"telemetry:posthog:source_status",
		() => postHogSourceStatus(),
		fresh,
		POSTHOG_CACHE_TTL,
	);
}

export async function getCachedPostHogActivity(
	preset: string,
	fromIso: string,
	toIso: string,
	excludedAccountIds: readonly string[] = [],
	fresh = false,
): Promise<Result<PostHogActivityData, PostHogError>> {
	return cached(
		`telemetry:posthog:activity:${preset}:${fromIso}:${toIso}:${excludedAccountIds.join(",")}`,
		() => postHogActivity(fromIso, toIso, excludedAccountIds),
		fresh,
		POSTHOG_CACHE_TTL,
	);
}

export async function getCachedPostHogRouteUsage(
	preset: string,
	fromIso: string,
	toIso: string,
	excludedAccountIds: readonly string[] = [],
	fresh = false,
): Promise<Result<PostHogRouteUsageItem[], PostHogError>> {
	return cached(
		`telemetry:posthog:route_usage:${preset}:${fromIso}:${toIso}:${excludedAccountIds.join(",")}`,
		() => postHogRouteUsage(fromIso, toIso, excludedAccountIds),
		fresh,
		POSTHOG_CACHE_TTL,
	);
}

export async function getCachedPostHogEventCoverage(
	preset: string,
	fromIso: string,
	toIso: string,
	excludedAccountIds: readonly string[] = [],
	fresh = false,
): Promise<Result<PostHogEventCoverageData, PostHogError>> {
	return cached(
		`telemetry:posthog:event_coverage:${preset}:${fromIso}:${toIso}:${excludedAccountIds.join(",")}`,
		() => postHogEventCoverage(fromIso, toIso, excludedAccountIds),
		fresh,
		POSTHOG_CACHE_TTL,
	);
}

export async function getCachedPostHogLatestEvents(
	fresh = false,
): Promise<Result<PostHogEventItem[], PostHogError>> {
	return cached(
		"telemetry:posthog:latest_events",
		() => postHogLatestEvents(),
		fresh,
		POSTHOG_CACHE_TTL,
	);
}
