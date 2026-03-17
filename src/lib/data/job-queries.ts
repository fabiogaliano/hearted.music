/**
 * Operational read paths for monitoring enrichment jobs.
 *
 * These queries are not scoped to a single account — they return
 * system-wide views used by worker dashboards and health checks.
 */

import type { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Job } from "./jobs";

/** Get all active (pending/running) enrichment jobs */
export function getActiveEnrichmentJobs(): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("job")
			.select()
			.eq("type", "enrichment")
			.in("status", ["pending", "running"])
			.order("created_at", { ascending: true }),
	);
}

/** Get recently failed enrichment jobs */
export function getFailedEnrichmentJobs(
	limit = 50,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("job")
			.select()
			.eq("type", "enrichment")
			.eq("status", "failed")
			.order("completed_at", { ascending: false })
			.limit(limit),
	);
}

/** Get dead-lettered enrichment jobs (failed with max attempts exhausted) */
export function getDeadLetteredEnrichmentJobs(
	limit = 50,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("job")
			.select()
			.eq("type", "enrichment")
			.eq("status", "failed")
			.filter("error", "eq", "max attempts exhausted after stale detection")
			.order("completed_at", { ascending: false })
			.limit(limit),
	);
}
