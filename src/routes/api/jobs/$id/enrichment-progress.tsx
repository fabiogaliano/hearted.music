/**
 * GET /api/jobs/$id/enrichment-progress - Polling endpoint for enrichment job progress.
 *
 * Returns the current status and progress of an enrichment job.
 * Used by useEnrichmentProgress hook (polling-based, unlike SSE progress endpoint).
 * TODO: Wire useEnrichmentProgress hook into onboarding/dashboard UI to consume this endpoint
 */

import { createFileRoute } from "@tanstack/react-router";
import { Result } from "better-result";
import { getAuthSession } from "@/lib/platform/auth/auth.server";
import { getJobById } from "@/lib/data/jobs";

export const Route = createFileRoute("/api/jobs/$id/enrichment-progress")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const jobId = params.id;

				if (
					!jobId ||
					!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						jobId,
					)
				) {
					return new Response(JSON.stringify({ error: "Invalid job ID" }), {
						status: 400,
						headers: { "Content-Type": "application/json" },
					});
				}

				const authContext = await getAuthSession();
				if (!authContext) {
					return new Response(JSON.stringify({ error: "Not found" }), {
						status: 404,
						headers: { "Content-Type": "application/json" },
					});
				}

				const jobResult = await getJobById(jobId);
				if (Result.isError(jobResult)) {
					return new Response(JSON.stringify({ error: "Internal error" }), {
						status: 500,
						headers: { "Content-Type": "application/json" },
					});
				}

				const job = jobResult.value;
				if (!job || job.account_id !== authContext.session.accountId) {
					return new Response(JSON.stringify({ error: "Not found" }), {
						status: 404,
						headers: { "Content-Type": "application/json" },
					});
				}

				return new Response(
					JSON.stringify({
						status: job.status,
						progress: job.progress,
						error: job.error,
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"Cache-Control": "no-cache",
						},
					},
				);
			},
		},
	},
});
