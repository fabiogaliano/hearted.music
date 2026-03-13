import { Result } from "better-result";
import { describe, it, expect } from "vitest";
import { runEnrichmentPipeline } from "../orchestrator";
import type { EnrichmentRunResult, EnrichmentStageResult } from "../types";

const TEST_ACCOUNT_ID = process.env.TEST_ACCOUNT_ID;
const HAS_SUPABASE =
	!!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_GEMINI = !!process.env.GEMINI_API_KEY;

const SHOULD_RUN = !!TEST_ACCOUNT_ID && HAS_SUPABASE && HAS_GEMINI;

function stageIsNotFailed(stage: EnrichmentStageResult): boolean {
	return stage.status === "completed" || stage.status === "skipped";
}

function stageIsNoOp(stage: EnrichmentStageResult): boolean {
	if (stage.status === "skipped") return true;
	if (stage.status === "completed" && stage.succeeded === 0) return true;
	return false;
}

let firstRunResult: Result<EnrichmentRunResult, unknown> | null = null;

describe.skipIf(!SHOULD_RUN)("Enrichment Pipeline Integration", () => {
	it("populates enrichment tables when pipeline runs", async () => {
		const result = await runEnrichmentPipeline(TEST_ACCOUNT_ID!, {
			batchSize: 2,
		});

		firstRunResult = result;

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { stages, totalDurationMs } = result.value;

		console.log(`[integration] Pipeline completed in ${totalDurationMs}ms`);

		expect(stages).toHaveLength(6);

		for (const stage of stages) {
			console.log(
				`  ${stage.stage}: ${stage.status}${stage.status === "completed" ? ` (succeeded=${stage.succeeded}, failed=${stage.failed})` : ""}`,
			);
			expect(stageIsNotFailed(stage)).toBe(true);
		}

		const matchingStage = stages.find((s) => s.stage === "matching");
		if (matchingStage?.status === "completed") {
			const { getLatestMatchContext, getMatchResults } = await import(
				"@/lib/domains/taste/song-matching/queries"
			);

			const ctxResult = await getLatestMatchContext(TEST_ACCOUNT_ID!);
			expect(Result.isOk(ctxResult)).toBe(true);
			if (Result.isOk(ctxResult) && ctxResult.value) {
				const matchResults = await getMatchResults(ctxResult.value.id);
				if (Result.isOk(matchResults)) {
					console.log(
						`[integration] match_result rows: ${matchResults.value.length}`,
					);
					expect(matchResults.value.length).toBeGreaterThan(0);
				}
			}
		}
	}, 120_000);

	it("second run is incremental no-op", async () => {
		expect(firstRunResult).not.toBeNull();
		if (!firstRunResult || !Result.isOk(firstRunResult)) return;

		const result = await runEnrichmentPipeline(TEST_ACCOUNT_ID!, {
			batchSize: 2,
		});

		expect(Result.isOk(result)).toBe(true);
		if (!Result.isOk(result)) return;

		const { stages, totalDurationMs } = result.value;

		console.log(`[integration] Second run completed in ${totalDurationMs}ms`);

		for (const stage of stages) {
			console.log(
				`  ${stage.stage}: ${stage.status}${stage.status === "completed" ? ` (succeeded=${stage.succeeded}, failed=${stage.failed})` : ""}`,
			);
			expect(stageIsNoOp(stage)).toBe(true);
		}
	}, 120_000);
});
