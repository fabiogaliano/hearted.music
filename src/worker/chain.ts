import { Result } from "better-result";
import { getOrCreateEnrichmentJob } from "@/lib/data/jobs";
import { makeInitialProgress } from "@/lib/workflows/enrichment-pipeline/progress";
import { getChunkSize } from "./batch-size";
import { log } from "./logger";

export type ChainOutcome =
	| { status: "completed" }
	| { status: "chained"; jobId: string }
	| { status: "error"; error: string };

export async function chainNextChunk(
	accountId: string,
	currentSequence: number,
	hasMoreSongs: boolean,
): Promise<ChainOutcome> {
	if (!hasMoreSongs) {
		log.info("chain-complete", { accountId, finalSequence: currentSequence });
		return { status: "completed" };
	}

	const nextSequence = currentSequence + 1;
	const nextSize = getChunkSize(nextSequence);
	const progress = makeInitialProgress(nextSize, nextSequence, 0);

	const result = await getOrCreateEnrichmentJob(accountId, progress);
	if (Result.isError(result)) {
		log.error("chain-failed", { accountId, error: result.error.message });
		return { status: "error", error: result.error.message };
	}

	log.info("chain-created", {
		accountId,
		jobId: result.value.id,
		batchSize: nextSize,
		sequence: nextSequence,
	});
	return { status: "chained", jobId: result.value.id };
}
