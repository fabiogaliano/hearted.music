import { Result } from "better-result";
import type { Json, Tables } from "@/lib/data/database.types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMaybe } from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "@/lib/data/client";

export type JobExecutionMeasurement = Tables<"job_execution_measurement">;

interface MeasurementInput {
	jobId: string;
	accountId: string;
	workflow: "enrichment" | "match_snapshot_refresh";
	queuePriority: number | null;
	attemptNumber: number;
	queuedAt: string | null;
	startedAt: string | null;
	finishedAt: string;
	outcome: string;
	details?: Record<string, Json>;
}

export async function recordJobExecutionMeasurement(
	input: MeasurementInput,
): Promise<Result<void, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { error } = await supabase.from("job_execution_measurement").insert({
		job_id: input.jobId,
		account_id: input.accountId,
		workflow: input.workflow,
		queue_priority: input.queuePriority,
		attempt_number: input.attemptNumber,
		queued_at: input.queuedAt,
		started_at: input.startedAt,
		finished_at: input.finishedAt,
		outcome: input.outcome,
		details: input.details ?? {},
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(undefined);
}

export function getLatestJobExecutionMeasurement(
	jobId: string,
): Promise<Result<JobExecutionMeasurement | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("job_execution_measurement")
			.select("*")
			.eq("job_id", jobId)
			.order("created_at", { ascending: false })
			.limit(1)
			.single(),
	);
}
