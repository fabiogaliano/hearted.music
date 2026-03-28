import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { requireAuthSession } from "@/lib/platform/auth/auth.server";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getJobById, JobProgressSchema } from "@/lib/data/jobs";
import { loadLibraryProcessingState } from "@/lib/workflows/library-processing/queries";

export interface ActiveJobInfo {
	id: string;
	status: "pending" | "running";
	progress: { done: number; total: number; succeeded: number; failed: number };
}

export interface ActiveJobs {
	enrichment: ActiveJobInfo | null;
	matchSnapshotRefresh: ActiveJobInfo | null;
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
		let matchSnapshotRefresh: ActiveJobInfo | null = null;

		if (Result.isOk(stateResult) && stateResult.value) {
			const state = stateResult.value;

			const [enrichmentResult, matchRefreshResult] = await Promise.all([
				state.enrichment.activeJobId
					? resolveJobInfo(state.enrichment.activeJobId)
					: null,
				state.matchSnapshotRefresh.activeJobId
					? resolveJobInfo(state.matchSnapshotRefresh.activeJobId)
					: null,
			]);
			enrichment = enrichmentResult;
			matchSnapshotRefresh = matchRefreshResult;
		}

		return {
			enrichment,
			matchSnapshotRefresh,
			firstMatchReady: firstMatchResult,
		};
	},
);

async function resolveJobInfo(jobId: string): Promise<ActiveJobInfo | null> {
	const result = await getJobById(jobId);
	if (Result.isError(result) || !result.value) return null;

	const job = result.value;
	if (job.status !== "pending" && job.status !== "running") return null;

	const progressResult = JobProgressSchema.partial().safeParse(
		job.progress ?? {},
	);
	const progress = progressResult.success ? progressResult.data : {};

	return {
		id: job.id,
		status: job.status,
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
	const { data: latestContext, error: latestContextError } = await supabase
		.from("match_context")
		.select("id")
		.eq("account_id", accountId)
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (latestContextError || latestContext === null) {
		return false;
	}

	const { data: latestMatchResult, error: latestMatchResultError } =
		await supabase
			.from("match_result")
			.select("id")
			.eq("context_id", latestContext.id)
			.limit(1)
			.maybeSingle();

	if (latestMatchResultError) {
		return false;
	}

	return latestMatchResult !== null;
}
