import { captureException } from "@sentry/bun";
import type { Result } from "better-result";
import { FAILURE_CODES } from "./failure-policy";
import {
	type FailureCode,
	finalizeStageOutcome,
	makeThrownOutcome,
	type StageAccountingError,
	type StageOutcome,
	type StageSummary,
} from "./stage-outcomes";
import type { EnrichmentStageName } from "./types";

interface RunStageWithAccountingParams {
	stage: EnrichmentStageName;
	candidateSongIds: string[];
	jobId: string;
	accountId: string;
	fallbackCode?: FailureCode;
	run: (candidateSongIds: string[]) => Promise<StageOutcome>;
}

export async function runStageWithAccounting(
	params: RunStageWithAccountingParams,
): Promise<Result<StageSummary, StageAccountingError>> {
	const {
		stage,
		candidateSongIds,
		jobId,
		accountId,
		fallbackCode = FAILURE_CODES.PROVIDER_TRANSIENT,
		run,
	} = params;

	let outcome: StageOutcome;
	try {
		outcome = await run(candidateSongIds);
	} catch (error) {
		// A throw here is a code bug, not a provider error, yet it is recorded per
		// song as a provider failure below — Sentry is the only place it shows.
		captureException(error, {
			tags: { workflow: "enrichment", stage },
			extra: { jobId, accountId, songCount: candidateSongIds.length },
		});
		console.error(`[worker-chunk] Stage ${stage} threw:`, error);
		outcome = makeThrownOutcome(stage, candidateSongIds, error, fallbackCode);
	}

	return finalizeStageOutcome({
		outcome,
		jobId,
		accountId,
	});
}
