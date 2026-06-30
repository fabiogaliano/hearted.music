import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { hasFirstVisibleReviewSubject } from "@/lib/domains/taste/match-review-queue/service";
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
	// firstVisibleMatchReady is the authoritative check (visible queue subject).
	// firstMatchReady is kept for backward-compatibility during migration and
	// always mirrors firstVisibleMatchReady.
	firstMatchReady: boolean;
	firstVisibleMatchReady: boolean;
}

export const getActiveJobs = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<ActiveJobs> => {
		const { session } = context;

		const [stateResult, firstVisibleResult] = await Promise.all([
			loadLibraryProcessingState(session.accountId),
			hasFirstVisibleReviewSubject(session.accountId),
		]);

		// Degrade gracefully on helper error — a transient DB failure must not
		// surface as a permanent false-empty state. No throw, matches the pattern
		// of the original deriveFirstMatchReady which also returned false on error.
		const firstVisibleMatchReady = Result.isOk(firstVisibleResult)
			? firstVisibleResult.value
			: false;

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
			firstMatchReady: firstVisibleMatchReady,
			firstVisibleMatchReady,
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
