import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import {
	type ParsedJobProgress,
	parseJobProgress,
} from "@/lib/platform/jobs/progress/parse";
import { getJobById } from "@/lib/platform/jobs/repository";
import { loadLibraryProcessingState } from "@/lib/workflows/library-processing/queries";

interface ProgressCounts {
	done: number;
	total: number;
	succeeded: number;
	failed: number;
}

export interface ActiveJobInfo {
	id: string;
	status: "pending" | "running";
	progress: ProgressCounts;
}

export interface ActiveJobs {
	enrichment: ActiveJobInfo | null;
	matchSnapshotRefresh: ActiveJobInfo | null;
	firstMatchReady: boolean;
}

export const getActiveJobs = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<ActiveJobs> => {
		const { session } = context;

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
					? resolveJobInfo(state.enrichment.activeJobId, session.accountId)
					: null,
				state.matchSnapshotRefresh.activeJobId
					? resolveJobInfo(
							state.matchSnapshotRefresh.activeJobId,
							session.accountId,
						)
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
	});

async function resolveJobInfo(
	jobId: string,
	accountId: string,
): Promise<ActiveJobInfo | null> {
	const result = await getJobById(jobId, accountId);
	if (Result.isError(result) || !result.value) return null;

	const job = result.value;
	if (job.status !== "pending" && job.status !== "running") return null;

	return {
		id: job.id,
		status: job.status,
		progress: extractProgressCounts(parseJobProgress(job.type, job.progress)),
	};
}

async function deriveFirstMatchReady(accountId: string): Promise<boolean> {
	const supabase = createAdminSupabaseClient();
	const { data: latestSnapshot, error: latestSnapshotError } = await supabase
		.from("match_snapshot")
		.select("id")
		.eq("account_id", accountId)
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (latestSnapshotError || latestSnapshot === null) {
		return false;
	}

	const { data: latestMatchResult, error: latestMatchResultError } =
		await supabase
			.from("match_result")
			.select("id")
			.eq("snapshot_id", latestSnapshot.id)
			.limit(1)
			.maybeSingle();

	if (latestMatchResultError) {
		return false;
	}

	return latestMatchResult !== null;
}

function extractProgressCounts(parsed: ParsedJobProgress): ProgressCounts {
	if (parsed.type === "unknown") {
		return {
			done: 0,
			total: 0,
			succeeded: 0,
			failed: 0,
		};
	}

	return {
		done: parsed.progress.done,
		total: parsed.progress.total,
		succeeded: parsed.progress.succeeded,
		failed: parsed.progress.failed,
	};
}
