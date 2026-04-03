import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Job } from "@/lib/data/jobs";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import {
	type ParsedJobProgress,
	parseJobProgress,
} from "@/lib/platform/jobs/progress/parse";
import {
	DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS,
	type WorkflowDevServerSettings,
	WorkflowDevServerSettingsSchema,
} from "@/lib/workflows/library-processing/devtools/settings";
import { loadLibraryProcessingState } from "@/lib/workflows/library-processing/queries";
import type { RunJobOutcome } from "@/lib/workflows/library-processing/runner";

const GuidedWorkflowInputSchema = z.object({
	settings: WorkflowDevServerSettingsSchema.optional(),
});

function resolveGuidedWorkflowSettings(
	settings: WorkflowDevServerSettings | undefined,
): WorkflowDevServerSettings {
	return settings ?? { ...DEFAULT_WORKFLOW_DEV_SERVER_SETTINGS };
}

function assertDevOnly(): void {
	if (!import.meta.env.DEV && process.env.NODE_ENV !== "test") {
		throw new Error(
			"Dev workflow functions are not available outside local development",
		);
	}
}

async function claimNextGuidedJob(accountId: string) {
	const { claimNextLibraryProcessingJobForAccount } = await import(
		"@/lib/data/jobs"
	);
	return claimNextLibraryProcessingJobForAccount(accountId);
}

async function runGuidedClaimedJob(
	job: Job,
	settings: WorkflowDevServerSettings,
): Promise<RunJobOutcome> {
	const { runClaimedJob } = await import(
		"@/lib/workflows/library-processing/runner"
	);
	return runClaimedJob(job, { settings });
}

async function runWarmReplayReset(accountId: string) {
	const { warmReplayReset } = await import(
		"@/lib/workflows/library-processing/devtools/reset"
	);
	return warmReplayReset(accountId);
}

async function runMatchOnlyReset(accountId: string) {
	const { matchOnlyReset } = await import(
		"@/lib/workflows/library-processing/devtools/reset"
	);
	return matchOnlyReset(accountId);
}

async function runReseedAfterReset(accountId: string) {
	const { reseedAfterReset } = await import(
		"@/lib/workflows/library-processing/devtools/reseed"
	);
	return reseedAfterReset(accountId);
}

export interface GuidedWorkflowState {
	enrichment: {
		requestedAt: string | null;
		settledAt: string | null;
		activeJobId: string | null;
	};
	matchSnapshotRefresh: {
		requestedAt: string | null;
		settledAt: string | null;
		activeJobId: string | null;
	};
	pendingJobs: Array<{
		id: string;
		type: Job["type"];
		status: Job["status"];
		progress: ParsedJobProgress;
		createdAt: string;
	}>;
}

export const getGuidedWorkflowState = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<GuidedWorkflowState> => {
		assertDevOnly();
		const { session } = context;

		const stateResult = await loadLibraryProcessingState(session.accountId);
		const state =
			Result.isOk(stateResult) && stateResult.value
				? stateResult.value
				: {
						enrichment: {
							requestedAt: null,
							settledAt: null,
							activeJobId: null,
						},
						matchSnapshotRefresh: {
							requestedAt: null,
							settledAt: null,
							activeJobId: null,
						},
					};

		const supabase = createAdminSupabaseClient();
		const { data: pendingRows, error } = await supabase
			.from("job")
			.select("id, type, status, progress, created_at")
			.eq("account_id", session.accountId)
			.in("type", ["enrichment", "match_snapshot_refresh"])
			.in("status", ["pending", "running"])
			.order("queue_priority", { ascending: false, nullsFirst: false })
			.order("created_at", { ascending: true });

		if (error) {
			throw new Error(`Failed to load guided workflow jobs: ${error.message}`);
		}

		const pendingJobs = (pendingRows ?? []).map((row) => ({
			id: row.id,
			type: row.type,
			status: row.status,
			progress: parseJobProgress(row.type, row.progress),
			createdAt: row.created_at,
		}));

		return {
			enrichment: state.enrichment,
			matchSnapshotRefresh: state.matchSnapshotRefresh,
			pendingJobs,
		};
	});

export interface StepResult {
	stepped: boolean;
	outcome: RunJobOutcome | null;
	jobId: string | null;
	jobType: Job["type"] | null;
}

export const stepLibraryProcessing = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.inputValidator((data) => GuidedWorkflowInputSchema.parse(data))
	.handler(async ({ data, context }): Promise<StepResult> => {
		assertDevOnly();
		const { session } = context;
		const claimResult = await claimNextGuidedJob(session.accountId);
		if (Result.isError(claimResult)) {
			throw new Error(
				`Failed to claim the next library-processing job: ${claimResult.error.message}`,
			);
		}

		const job = claimResult.value;
		if (!job) {
			return { stepped: false, outcome: null, jobId: null, jobType: null };
		}

		const outcome = await runGuidedClaimedJob(
			job,
			resolveGuidedWorkflowSettings(data.settings),
		);
		return {
			stepped: true,
			outcome,
			jobId: job.id,
			jobType: job.type,
		};
	});

export interface RunUntilIdleResult {
	jobsRun: number;
	outcomes: Array<{
		jobId: string;
		jobType: Job["type"];
		status: "completed" | "failed";
	}>;
	stoppedReason: "idle" | "cap_reached";
}

export const runLibraryProcessingUntilIdle = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.inputValidator((data) => GuidedWorkflowInputSchema.parse(data))
	.handler(async ({ data, context }): Promise<RunUntilIdleResult> => {
		assertDevOnly();
		const { session } = context;
		const settings = resolveGuidedWorkflowSettings(data.settings);
		const outcomes: RunUntilIdleResult["outcomes"] = [];
		let jobsRun = 0;

		while (jobsRun < settings.runUntilIdleMaxJobs) {
			const claimResult = await claimNextGuidedJob(session.accountId);
			if (Result.isError(claimResult)) {
				throw new Error(
					`Failed to claim a library-processing job: ${claimResult.error.message}`,
				);
			}

			const job = claimResult.value;
			if (!job) {
				return { jobsRun, outcomes, stoppedReason: "idle" };
			}

			const outcome = await runGuidedClaimedJob(job, settings);
			jobsRun += 1;
			outcomes.push({
				jobId: job.id,
				jobType: job.type,
				status: outcome.status,
			});
		}

		return { jobsRun, outcomes, stoppedReason: "cap_reached" };
	});

export interface WarmReplayResetResult {
	reset: {
		cancelledJobs: number;
		clearedItemStatuses: number;
		clearedMatchSnapshots: number;
	};
	reseed: {
		enrichmentRequested: boolean;
		matchRefreshRequested: boolean;
	};
}

export const resetLibraryProcessingWarmReplay = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<WarmReplayResetResult> => {
		assertDevOnly();
		const { session } = context;

		const resetResult = await runWarmReplayReset(session.accountId);
		const reseedResult = await runReseedAfterReset(session.accountId);

		return { reset: resetResult, reseed: reseedResult };
	});

export interface MatchOnlyResetResult {
	reset: {
		cancelledJobs: number;
		clearedMatchSnapshots: number;
	};
	reseed: {
		enrichmentRequested: boolean;
		matchRefreshRequested: boolean;
	};
}

export const resetMatchSnapshotReplay = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<MatchOnlyResetResult> => {
		assertDevOnly();
		const { session } = context;

		const resetResult = await runMatchOnlyReset(session.accountId);
		const reseedResult = await runReseedAfterReset(session.accountId);

		return { reset: resetResult, reseed: reseedResult };
	});
