import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getJobById, type JobProgress } from "@/lib/data/jobs";
import { loadLibraryProcessingState } from "@/lib/workflows/library-processing/queries";

export interface ActiveJobInfo {
	id: string;
	status: "pending" | "running";
	progress: { done: number; total: number; succeeded: number; failed: number };
}

export interface ActiveJobs {
	enrichment: ActiveJobInfo | null;
	targetPlaylistMatchRefresh: ActiveJobInfo | null;
	firstMatchReady: boolean;
}

export const getActiveJobs = createServerFn({ method: "GET" }).handler(
	async (): Promise<ActiveJobs> => {
		const { session } = await requireAuthSession();

		const [stateResult, firstMatchResult] = await Promise.all([
			loadLibraryProcessingState(session.accountId),
			deriveFirstMatchReady(session.accountId),
		]);

		let enrichment: ActiveJobInfo | null = null;
		let targetPlaylistMatchRefresh: ActiveJobInfo | null = null;

		if (Result.isOk(stateResult) && stateResult.value) {
			const state = stateResult.value;

			if (state.enrichment.activeJobId) {
				enrichment = await resolveJobInfo(state.enrichment.activeJobId);
			}
			if (state.matchSnapshotRefresh.activeJobId) {
				targetPlaylistMatchRefresh = await resolveJobInfo(
					state.matchSnapshotRefresh.activeJobId,
				);
			}
		}

		return {
			enrichment,
			targetPlaylistMatchRefresh,
			firstMatchReady: firstMatchResult,
		};
	},
);

async function resolveJobInfo(jobId: string): Promise<ActiveJobInfo | null> {
	const result = await getJobById(jobId);
	if (Result.isError(result) || !result.value) return null;

	const job = result.value;
	if (job.status !== "pending" && job.status !== "running") return null;

	const progress = (job.progress ?? {}) as JobProgress;
	return {
		id: job.id,
		status: job.status as "pending" | "running",
		progress: {
			done: progress.done ?? 0,
			total: progress.total ?? 0,
			succeeded: progress.succeeded ?? 0,
			failed: progress.failed ?? 0,
		},
	};
}

async function deriveFirstMatchReady(accountId: string): Promise<boolean> {
	const supabase = createAdminSupabaseClient();
	const { data } = await supabase
		.from("match_context")
		.select("id, song_count")
		.eq("account_id", accountId)
		.order("created_at", { ascending: false })
		.limit(1)
		.single();

	return data !== null && (data.song_count ?? 0) > 0;
}
