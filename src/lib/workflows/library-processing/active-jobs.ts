/**
 * Active-jobs read model: the account's in-flight enrichment and snapshot
 * refresh jobs plus first-visible-match readiness, derived from
 * library_processing_state. Served by the getActiveJobs server fn and pushed
 * by the worker's account-events gateway.
 */

import { Result } from "better-result";
import {
	hasFirstVisibleReviewSubject,
	resolveReadinessConservative,
} from "@/lib/domains/taste/match-review-queue/readiness";
import { captureServerError } from "@/lib/observability/capture-server-error";
import {
	type ParsedJobProgress,
	parseJobProgress,
} from "@/lib/platform/jobs/progress/parse";
import { getJobById } from "@/lib/platform/jobs/repository";
import { loadLibraryProcessingState } from "./queries";

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
	// Whether the account has a visible review subject (the authoritative check).
	firstVisibleMatchReady: boolean;
}

export async function buildActiveJobsSnapshot(
	accountId: string,
): Promise<ActiveJobs> {
	const [stateResult, firstVisibleResult] = await Promise.all([
		loadLibraryProcessingState(accountId),
		hasFirstVisibleReviewSubject(accountId),
	]);

	// Conservative: error → false so a transient DB failure must not
	// surface as a permanent false-empty state on the UI.
	const firstVisibleMatchReady =
		resolveReadinessConservative(firstVisibleResult);

	if (Result.isError(stateResult)) {
		captureServerError(stateResult.error, {
			area: "jobs",
			operation: "build_active_jobs_snapshot",
			accountId,
		});
	}

	let enrichment: ActiveJobInfo | null = null;
	let matchSnapshotRefresh: ActiveJobInfo | null = null;

	if (Result.isOk(stateResult) && stateResult.value) {
		const state = stateResult.value;

		const [enrichmentResult, matchRefreshResult] = await Promise.all([
			state.enrichment.activeJobId
				? resolveJobInfo(state.enrichment.activeJobId, accountId)
				: null,
			state.matchSnapshotRefresh.activeJobId
				? resolveJobInfo(state.matchSnapshotRefresh.activeJobId, accountId)
				: null,
		]);
		enrichment = enrichmentResult;
		matchSnapshotRefresh = matchRefreshResult;
	}

	return {
		enrichment,
		matchSnapshotRefresh,
		firstVisibleMatchReady,
	};
}

async function resolveJobInfo(
	jobId: string,
	accountId: string,
): Promise<ActiveJobInfo | null> {
	const result = await getJobById(jobId, accountId);
	if (Result.isError(result)) {
		captureServerError(result.error, {
			area: "jobs",
			operation: "resolve_job_info",
			accountId,
			extra: { jobId },
		});
		return null;
	}
	if (!result.value) return null;

	const job = result.value;
	if (job.status !== "pending" && job.status !== "running") return null;

	return {
		id: job.id,
		status: job.status,
		progress: extractProgressCounts(parseJobProgress(job.type, job.progress)),
	};
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
