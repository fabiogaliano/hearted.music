/**
 * How one claimed library-processing run ended, as a single value. Every
 * record of that ending (the job row's terminal status, the account events,
 * the execution measurement, and the library-processing change) is a pure
 * projection of it, so the four can never disagree, and recovery can rebuild
 * the change from the measurement alone.
 */

import { z } from "zod";
import type { AccountEventType } from "@/lib/account-events/contract";
import type { WriteAccountEventInput } from "@/lib/account-events/producer";
import type { Json, Tables } from "@/lib/data/database.types";
import type { EnrichmentExecuteResult } from "@/lib/workflows/enrichment-pipeline/types";
import type { MatchSnapshotRefreshExecuteResult } from "@/lib/workflows/match-snapshot-refresh/types";
import { EnrichmentChanges, MatchSnapshotChanges } from "./changes";
import type { LibraryProcessingChange } from "./types";

export interface EnrichmentRunCounts {
	ready: number;
	done: number;
	total: number;
	succeeded: number;
	failed: number;
}

interface OutcomeIds {
	jobId: string;
	accountId: string;
}

export type WorkerOutcome =
	| (OutcomeIds & {
			workflow: "enrichment";
			status: "completed";
			batchSequence: number;
			requestSatisfied: boolean;
			newCandidatesAvailable: boolean;
			counts: EnrichmentRunCounts;
	  })
	// The chunk attempted zero songs while work is still owed. It ends the job
	// as completed but stops the workflow, so the reconciler does not re-ensure
	// a job that would make no progress either.
	| (OutcomeIds & {
			workflow: "enrichment";
			status: "blocked";
			batchSequence: number;
			counts: EnrichmentRunCounts;
	  })
	| (OutcomeIds & { workflow: "enrichment"; status: "failed"; error: string })
	| (OutcomeIds & {
			workflow: "match_snapshot_refresh";
			status: "published";
			published: boolean;
			isEmpty: boolean;
			// Null on a no-op refresh: same hash, no new snapshot row.
			snapshotId: string | null;
	  })
	// A newer request superseded the run before it published.
	| (OutcomeIds & { workflow: "match_snapshot_refresh"; status: "superseded" })
	| (OutcomeIds & {
			workflow: "match_snapshot_refresh";
			status: "failed";
			error: string;
	  });

export function enrichmentRunOutcome(
	result: EnrichmentExecuteResult,
): WorkerOutcome {
	const ids = { jobId: result.jobId, accountId: result.accountId };
	const counts: EnrichmentRunCounts = {
		ready: result.readyCount,
		done: result.doneCount,
		total: result.totalCount,
		succeeded: result.succeededCount,
		failed: result.failedCount,
	};
	if (result.doneCount === 0 && result.hasMoreSongs) {
		return {
			...ids,
			workflow: "enrichment",
			status: "blocked",
			batchSequence: result.batchSequence,
			counts,
		};
	}
	return {
		...ids,
		workflow: "enrichment",
		status: "completed",
		batchSequence: result.batchSequence,
		requestSatisfied: !result.hasMoreSongs,
		newCandidatesAvailable: result.newCandidatesAvailable,
		counts,
	};
}

export function matchSnapshotRefreshRunOutcome(
	result: Exclude<MatchSnapshotRefreshExecuteResult, { status: "lease_lost" }>,
): WorkerOutcome {
	const ids = { jobId: result.jobId, accountId: result.accountId };
	switch (result.status) {
		case "published":
			return {
				...ids,
				workflow: "match_snapshot_refresh",
				status: "published",
				published: result.published,
				isEmpty: result.isEmpty,
				snapshotId: result.snapshotId,
			};
		case "superseded":
			return {
				...ids,
				workflow: "match_snapshot_refresh",
				status: "superseded",
			};
	}
}

export function finalStatusOf(outcome: WorkerOutcome): "completed" | "failed" {
	switch (outcome.status) {
		case "completed":
		case "blocked":
		case "published":
		case "superseded":
			return "completed";
		case "failed":
			return "failed";
	}
}

/** The text the job row's `error` column holds once this outcome is final. */
export function finalErrorOf(outcome: WorkerOutcome): string | null {
	return outcome.status === "failed" ? outcome.error : null;
}

type OutcomeEventType = Extract<
	AccountEventType,
	| "enrichment_completed"
	| "enrichment_stopped"
	| "match_snapshot_published"
	| "match_snapshot_failed"
	| "active_jobs_changed"
>;

export type OutcomeAccountEvent = {
	[T in OutcomeEventType]: WriteAccountEventInput<T>;
}[OutcomeEventType];

const NO_COUNTS = { done: 0, total: 0, succeeded: 0, failed: 0 };

function eventCounts(counts: EnrichmentRunCounts) {
	return {
		done: counts.done,
		total: counts.total,
		succeeded: counts.succeeded,
		failed: counts.failed,
	};
}

export function accountEventsOf(outcome: WorkerOutcome): OutcomeAccountEvent[] {
	const { accountId, jobId } = outcome;
	switch (outcome.workflow) {
		case "enrichment":
			switch (outcome.status) {
				case "completed":
					return [
						{
							accountId,
							type: "enrichment_completed",
							payload: { jobId, counts: eventCounts(outcome.counts) },
						},
					];
				case "blocked":
					return [
						{
							accountId,
							type: "enrichment_stopped",
							payload: {
								jobId,
								reason: "blocked",
								counts: eventCounts(outcome.counts),
							},
						},
					];
				case "failed":
					return [
						{
							accountId,
							type: "enrichment_stopped",
							payload: { jobId, reason: "failed", counts: NO_COUNTS },
						},
					];
			}
			break;
		case "match_snapshot_refresh":
			switch (outcome.status) {
				case "published": {
					const { snapshotId } = outcome;
					if (snapshotId === null) {
						return [{ accountId, type: "active_jobs_changed", payload: {} }];
					}
					return [
						{
							accountId,
							type: "match_snapshot_published",
							payload: { orientation: "song", snapshotId },
						},
						{
							accountId,
							type: "match_snapshot_published",
							payload: { orientation: "playlist", snapshotId },
						},
					];
				}
				case "superseded":
					return [{ accountId, type: "active_jobs_changed", payload: {} }];
				case "failed":
					return [
						{
							accountId,
							type: "match_snapshot_failed",
							payload: {
								orientation: null,
								snapshotId: null,
								reason: outcome.error,
							},
						},
					];
			}
	}
}

type MeasurementRow = Pick<
	Tables<"job_execution_measurement">,
	"job_id" | "account_id" | "workflow" | "outcome" | "details"
>;

/** The outcome-bearing columns of the run's `job_execution_measurement` row. */
export type OutcomeMeasurement = MeasurementRow & {
	outcome: "completed" | "blocked" | "error" | "superseded";
	details: { [key: string]: Json };
};

function countDetails(counts: EnrichmentRunCounts) {
	return {
		readyCount: counts.ready,
		doneCount: counts.done,
		totalCount: counts.total,
		succeededCount: counts.succeeded,
		failedCount: counts.failed,
	};
}

export function measurementOf(outcome: WorkerOutcome): OutcomeMeasurement {
	const row = {
		job_id: outcome.jobId,
		account_id: outcome.accountId,
		workflow: outcome.workflow,
	};
	switch (outcome.workflow) {
		case "enrichment":
			switch (outcome.status) {
				case "completed":
					return {
						...row,
						outcome: "completed",
						details: {
							requestSatisfied: outcome.requestSatisfied,
							newCandidatesAvailable: outcome.newCandidatesAvailable,
							batchSequence: outcome.batchSequence,
							...countDetails(outcome.counts),
						},
					};
				case "blocked":
					return {
						...row,
						outcome: "blocked",
						details: {
							batchSequence: outcome.batchSequence,
							...countDetails(outcome.counts),
						},
					};
				case "failed":
					return {
						...row,
						outcome: "error",
						details: { error: outcome.error },
					};
			}
			break;
		case "match_snapshot_refresh":
			switch (outcome.status) {
				case "published":
					return {
						...row,
						outcome: "completed",
						details: {
							published: outcome.published,
							isEmpty: outcome.isEmpty,
							snapshotId: outcome.snapshotId,
						},
					};
				case "superseded":
					return { ...row, outcome: "superseded", details: {} };
				case "failed":
					return {
						...row,
						outcome: "error",
						details: { error: outcome.error },
					};
			}
	}
}

export function changeOf(outcome: WorkerOutcome): LibraryProcessingChange {
	const { accountId, jobId } = outcome;
	switch (outcome.workflow) {
		case "enrichment":
			switch (outcome.status) {
				case "completed":
					return EnrichmentChanges.completed({
						accountId,
						jobId,
						requestSatisfied: outcome.requestSatisfied,
						newCandidatesAvailable: outcome.newCandidatesAvailable,
					});
				case "blocked":
					return EnrichmentChanges.stopped({
						accountId,
						jobId,
						reason: "blocked",
					});
				case "failed":
					return EnrichmentChanges.stopped({
						accountId,
						jobId,
						reason: "error",
					});
			}
			break;
		case "match_snapshot_refresh":
			switch (outcome.status) {
				case "published":
					return MatchSnapshotChanges.published({ accountId, jobId });
				case "superseded":
					return MatchSnapshotChanges.superseded({ accountId, jobId });
				case "failed":
					return MatchSnapshotChanges.failed({ accountId, jobId });
			}
	}
}

// Rows written before the outcome carried every field lack the newer details
// keys (totalCount, succeeded/failed on blocked runs, error, snapshotId); they
// decode with neutral defaults, since recovery needs only the change they map to.
const count = z.number().int().min(0).default(0);
const ids = { job_id: z.string(), account_id: z.string() };
const enrichmentCountDetails = {
	batchSequence: count,
	readyCount: count,
	doneCount: count,
	totalCount: count,
	succeededCount: count,
	failedCount: count,
};
const toCounts = (d: {
	readyCount: number;
	doneCount: number;
	totalCount: number;
	succeededCount: number;
	failedCount: number;
}): EnrichmentRunCounts => ({
	ready: d.readyCount,
	done: d.doneCount,
	total: d.totalCount,
	succeeded: d.succeededCount,
	failed: d.failedCount,
});
// An "error" row marked retrying records a requeued attempt, not an ending.
const failedDetails = z.object({
	error: z.string().default("unknown_error"),
	retrying: z.literal(false).optional(),
});

const WorkerOutcomeMeasurementSchema = z.union([
	z
		.object({
			...ids,
			workflow: z.literal("enrichment"),
			outcome: z.literal("completed"),
			details: z.object({
				requestSatisfied: z.boolean(),
				newCandidatesAvailable: z.boolean(),
				...enrichmentCountDetails,
			}),
		})
		.transform(
			(row): WorkerOutcome => ({
				jobId: row.job_id,
				accountId: row.account_id,
				workflow: "enrichment",
				status: "completed",
				batchSequence: row.details.batchSequence,
				requestSatisfied: row.details.requestSatisfied,
				newCandidatesAvailable: row.details.newCandidatesAvailable,
				counts: toCounts(row.details),
			}),
		),
	z
		.object({
			...ids,
			workflow: z.literal("enrichment"),
			outcome: z.literal("blocked"),
			details: z.object(enrichmentCountDetails),
		})
		.transform(
			(row): WorkerOutcome => ({
				jobId: row.job_id,
				accountId: row.account_id,
				workflow: "enrichment",
				status: "blocked",
				batchSequence: row.details.batchSequence,
				counts: toCounts(row.details),
			}),
		),
	z
		.object({
			...ids,
			workflow: z.literal("enrichment"),
			outcome: z.literal("error"),
			details: failedDetails,
		})
		.transform(
			(row): WorkerOutcome => ({
				jobId: row.job_id,
				accountId: row.account_id,
				workflow: "enrichment",
				status: "failed",
				error: row.details.error,
			}),
		),
	z
		.object({
			...ids,
			workflow: z.literal("match_snapshot_refresh"),
			outcome: z.literal("completed"),
			details: z.object({
				published: z.boolean(),
				isEmpty: z.boolean(),
				snapshotId: z.string().nullable().default(null),
			}),
		})
		.transform(
			(row): WorkerOutcome => ({
				jobId: row.job_id,
				accountId: row.account_id,
				workflow: "match_snapshot_refresh",
				status: "published",
				published: row.details.published,
				isEmpty: row.details.isEmpty,
				snapshotId: row.details.snapshotId,
			}),
		),
	z
		.object({
			...ids,
			workflow: z.literal("match_snapshot_refresh"),
			outcome: z.literal("superseded"),
		})
		.transform(
			(row): WorkerOutcome => ({
				jobId: row.job_id,
				accountId: row.account_id,
				workflow: "match_snapshot_refresh",
				status: "superseded",
			}),
		),
	z
		.object({
			...ids,
			workflow: z.literal("match_snapshot_refresh"),
			outcome: z.literal("error"),
			details: failedDetails,
		})
		.transform(
			(row): WorkerOutcome => ({
				jobId: row.job_id,
				accountId: row.account_id,
				workflow: "match_snapshot_refresh",
				status: "failed",
				error: row.details.error,
			}),
		),
]);

/**
 * Rebuilds the outcome a measurement row recorded. Null when the row records
 * no ending (a retried attempt) or its details are unreadable.
 */
export function workerOutcomeFromMeasurement(
	row: MeasurementRow,
): WorkerOutcome | null {
	const parsed = WorkerOutcomeMeasurementSchema.safeParse(row);
	return parsed.success ? parsed.data : null;
}
