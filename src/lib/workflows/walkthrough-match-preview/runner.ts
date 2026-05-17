/**
 * Worker-side runner for walkthrough_match_preview jobs.
 *
 * Deliberately does NOT call applyLibraryProcessingChange or any
 * match_snapshot/match_result writer — the preview is an onboarding-scoped
 * artifact that must never enter the production matching pipeline.
 */

import { Result } from "better-result";

import {
	type Job,
	markJobCompleted,
	markJobFailed,
} from "@/lib/platform/jobs/repository";

import {
	executeWalkthroughPreview,
	type WalkthroughPreviewExecuteResult,
} from "./orchestrator";

export type WalkthroughPreviewRunOutcome =
	| {
			status: "completed";
			result: WalkthroughPreviewExecuteResult;
	  }
	| {
			status: "failed";
			error: string;
	  };

export async function runWalkthroughPreviewJob(
	job: Job,
): Promise<WalkthroughPreviewRunOutcome> {
	try {
		const result = await executeWalkthroughPreview(job.account_id);

		const completedResult = await markJobCompleted(job.id);
		if (Result.isError(completedResult)) {
			throw new Error(completedResult.error.message);
		}

		return { status: "completed", result };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const failResult = await markJobFailed(job.id, message);
		if (Result.isError(failResult)) {
			console.error(
				`[walkthrough-preview] mark-failed-error job=${job.id}: ${failResult.error.message}`,
			);
		}
		return { status: "failed", error: message };
	}
}
