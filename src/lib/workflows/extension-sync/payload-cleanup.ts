/**
 * Storage cleanup for dead-lettered extension_sync jobs.
 *
 * The runner deletes the staged object on every normal terminal path, and the
 * route deletes it on active/cooldown/begin-failure. The remaining orphan
 * source is a dead-lettered job (worker died, attempts exhausted): the SQL
 * dead-letter sweep can't touch Storage, so the worker does it here using the
 * payload pointer still held in each dead job's `progress`.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { log } from "@/lib/observability/logger";
import { parseExtensionSyncJobProgress } from "@/lib/platform/jobs/extension-sync-jobs";
import type { Job } from "@/lib/platform/jobs/repository";
import { deleteSyncPayload } from "@/lib/workflows/extension-sync/payload-storage";

export async function deleteOrphanedSyncPayloads(jobs: Job[]): Promise<void> {
	if (jobs.length === 0) return;
	const supabase = createAdminSupabaseClient();

	await Promise.all(
		jobs.map(async (job) => {
			const progressResult = parseExtensionSyncJobProgress(job.progress);
			if (Result.isError(progressResult)) return;

			const deleteResult = await deleteSyncPayload(
				supabase,
				progressResult.value.payload_path,
			);
			if (Result.isError(deleteResult)) {
				log.warn("extension-sync-orphan-payload-delete-failed", {
					jobId: job.id,
					accountId: job.account_id,
					error: deleteResult.error.message,
				});
			}
		}),
	);
}
