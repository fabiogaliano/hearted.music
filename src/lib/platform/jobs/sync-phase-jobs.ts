import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Job, JobType } from "@/lib/platform/jobs/repository";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMaybe } from "@/lib/shared/utils/result-wrappers/supabase";

// Includes the extension_sync parent so getLastCompletedSync/getActiveSync
// reflect the async pipeline's canonical job, alongside the three phase rows
// they have always covered.
const SYNC_JOB_TYPES: JobType[] = [
	"extension_sync",
	"sync_liked_songs",
	"sync_playlists",
	"sync_playlist_tracks",
];

export function getActiveSync(
	accountId: string,
): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("job")
			.select("*")
			.eq("account_id", accountId)
			.in("status", ["pending", "running"])
			.in("type", SYNC_JOB_TYPES)
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

export function getLastCompletedSync(
	accountId: string,
): Promise<Result<Job | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("job")
			.select("*")
			.eq("account_id", accountId)
			.eq("status", "completed")
			.in("type", SYNC_JOB_TYPES)
			.order("completed_at", { ascending: false })
			.limit(1)
			.single(),
	);
}

/**
 * Fails any sync_* jobs for this account still stuck in pending/running past
 * the stale threshold. Sync jobs are inline request work with no worker sweep,
 * so a request that died after creating phase jobs can otherwise leave them
 * active forever and lock the account out of getActiveSync's gate. Run as a
 * preflight before the active-sync check so the gate sees a self-healed state.
 *
 * Returns the rows it failed (empty when nothing was stale).
 */
export async function markStaleSyncJobs(
	accountId: string,
	staleThreshold: string,
): Promise<Result<Job[], DbError>> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("mark_stale_extension_sync_jobs", {
		p_account_id: accountId,
		p_stale_threshold: staleThreshold,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok((data ?? []) as Job[]);
}
