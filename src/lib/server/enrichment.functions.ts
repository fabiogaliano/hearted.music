import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { log } from "@/lib/observability/logger";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { hasPhase1SongsNeedingEnrichment } from "@/lib/workflows/enrichment-pipeline/phase1-backfill";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

export type RequestLibraryPhase1EnrichmentResult =
	| { status: "scheduled"; jobId: string }
	| { status: "already_running" }
	| { status: "nothing_to_do" }
	| { status: "error"; message: string };

/**
 * On-demand trigger for Phase-1 enrichment (audio features + genre tagging)
 * for the current account's liked songs.
 *
 * Idempotent: if an enrichment job is already active, or there is no Phase-1
 * work pending, the call is a no-op and returns the appropriate status.
 * Analysis and embeddings are NOT triggered here — those remain entitlement-
 * gated via the normal library-processing workflow.
 *
 * Intended to be called from the playlist-creation route loader so that
 * every user has genre/audio data available for the playlist preview engine.
 */
export const requestLibraryPhase1Enrichment = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(
		async ({ context }): Promise<RequestLibraryPhase1EnrichmentResult> => {
			const { accountId } = context.session;

			const hasWork = await hasPhase1SongsNeedingEnrichment(accountId);
			if (!hasWork) {
				return { status: "nothing_to_do" };
			}

			const outcome = await applyLibraryProcessingChange({
				kind: "enrichment_work_available",
				accountId,
			});

			if (Result.isError(outcome)) {
				const message = outcome.error.cause
					? String(
							"message" in outcome.error.cause
								? outcome.error.cause.message
								: outcome.error.cause,
						)
					: outcome.error.kind;
				log.error("phase1-backfill-schedule-failed", { accountId, message });
				return { status: "error", message };
			}

			const { effectResults } = outcome.value;
			const enrichmentEffect = effectResults.find(
				(r) => r.kind === "ensure_enrichment_job",
			);

			if (enrichmentEffect) {
				log.info("phase1-backfill-scheduled", {
					accountId,
					jobId: enrichmentEffect.jobId,
				});
				return { status: "scheduled", jobId: enrichmentEffect.jobId };
			}

			// Reconciler produced no enrichment effect — a job is already active
			// or the state machine determined the request is already satisfied.
			return { status: "already_running" };
		},
	);
