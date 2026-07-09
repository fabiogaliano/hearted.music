import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { log } from "@/lib/observability/logger";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { MaintenanceChanges } from "@/lib/workflows/library-processing/changes/maintenance";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

export type RequestLibraryPhase1EnrichmentResult =
	| { status: "scheduled"; jobId: string }
	| { status: "already_running" }
	| { status: "error"; message: string };

/**
 * On-demand trigger for Phase-1 enrichment (audio features + genre tagging) for
 * the current account's liked songs, called from the playlist-creation route so
 * every user has genre/audio data for the preview engine.
 *
 * Idempotent by construction: it applies the enrichment_work_available change
 * and lets the library-processing reconciler decide whether to ensure a job —
 * no probe, no polling loop (the reconciler owns that state machine). If
 * enrichment is already active, or the reconciler finds nothing stale, no job
 * is ensured and the call reports already_running. The work the ensured job
 * actually drains is found by the ungated Phase-1 selector, so scheduling here
 * benefits free accounts; Phase-2/3 stages stay entitlement-gated inside the
 * pipeline regardless of this trigger.
 */
export const requestLibraryPhase1Enrichment = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.handler(
		async ({ context }): Promise<RequestLibraryPhase1EnrichmentResult> => {
			const { accountId } = context.session;

			const outcome = await applyLibraryProcessingChange(
				MaintenanceChanges.enrichmentWorkAvailable(accountId),
			);

			if (Result.isError(outcome)) {
				const message = outcome.error.cause
					? String(
							"message" in outcome.error.cause
								? outcome.error.cause.message
								: outcome.error.cause,
						)
					: outcome.error.kind;
				log.error("phase1-enrichment-schedule-failed", { accountId, message });
				return { status: "error", message };
			}

			const enrichmentEffect = outcome.value.effectResults.find(
				(r) => r.kind === "ensure_enrichment_job",
			);

			if (enrichmentEffect) {
				log.info("phase1-enrichment-scheduled", {
					accountId,
					jobId: enrichmentEffect.jobId,
				});
				return { status: "scheduled", jobId: enrichmentEffect.jobId };
			}

			// Reconciler produced no enrichment effect — a job is already active or
			// the state machine determined the request is already satisfied.
			return { status: "already_running" };
		},
	);
