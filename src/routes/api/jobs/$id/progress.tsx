/**
 * GET /api/jobs/$id/progress - SSE endpoint for job progress updates.
 *
 * Streams real-time job progress events to the client using Server-Sent Events.
 * Works on Cloudflare Workers (no WebSocket dependency).
 *
 * Events:
 * - progress: { type: "progress", done, total, succeeded, failed }
 * - status: { type: "status", status }
 * - item: { type: "item", itemId, itemKind, status, label?, index? }
 * - error: { type: "error", message }
 */

import { Result } from "better-result";
import { createFileRoute } from "@tanstack/react-router";
import { getSession } from "@/lib/auth/session";
import { getJobById, type JobProgress } from "@/lib/data/jobs";
import { subscribe, unsubscribeAll } from "@/lib/jobs/progress/emitter";
import {
	serializeSSEEvent,
	serializeSSEPing,
	TERMINAL_JOB_STATUSES,
	type JobEvent,
} from "@/lib/jobs/progress/types";

/** Keep-alive ping interval (30 seconds) */
const PING_INTERVAL_MS = 30_000;

/** Terminal job statuses (from Zod schema) */
const TERMINAL_STATUSES = new Set<string>(TERMINAL_JOB_STATUSES);

export const Route = createFileRoute("/api/jobs/$id/progress")({
	server: {
		handlers: {
			GET: async ({ request, params }) => {
				const jobId = params.id;

				// Validate UUID format
				if (
					!jobId ||
					!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						jobId,
					)
				) {
					return new Response("Invalid job ID", { status: 400 });
				}

				// Check authentication - return 404 to not reveal endpoint existence
				const session = getSession(request);
				if (!session) {
					return new Response("Not found", { status: 404 });
				}

				// Get job and verify ownership
				const jobResult = await getJobById(jobId);
				if (Result.isError(jobResult)) {
					return new Response("Internal error", { status: 500 });
				}

				const job = jobResult.value;
				if (!job || job.account_id !== session.accountId) {
					// Return 404 for both not found and not owned (security)
					return new Response("Not found", { status: 404 });
				}

				// Create SSE stream
				const encoder = new TextEncoder();
				let pingInterval: ReturnType<typeof setInterval> | null = null;
				let unsubscribe: (() => void) | null = null;

				const stream = new ReadableStream({
					start(controller) {
						// Send initial state immediately (but skip if total=0, meaning "not discovered yet")
						const progress = job.progress as JobProgress | null;
						if (progress && progress.total > 0) {
							const initialEvent: JobEvent = {
								type: "progress",
								done: progress.done,
								total: progress.total,
								succeeded: progress.succeeded,
								failed: progress.failed,
							};
							controller.enqueue(
								encoder.encode(serializeSSEEvent(initialEvent)),
							);
						}

						// Send current status
						const statusEvent: JobEvent = {
							type: "status",
							status: job.status,
						};
						controller.enqueue(encoder.encode(serializeSSEEvent(statusEvent)));

						// If already terminal, close immediately
						if (TERMINAL_STATUSES.has(job.status)) {
							controller.close();
							return;
						}

						// Subscribe to events
						unsubscribe = subscribe(jobId, (event) => {
							try {
								controller.enqueue(encoder.encode(serializeSSEEvent(event)));

								// Close stream on terminal status
								if (
									event.type === "status" &&
									TERMINAL_STATUSES.has(event.status)
								) {
									if (pingInterval) clearInterval(pingInterval);
									unsubscribeAll(jobId);
									controller.close();
								}
							} catch {
								// Stream may be closed, ignore errors
							}
						});

						// Start keep-alive pings
						pingInterval = setInterval(() => {
							try {
								controller.enqueue(encoder.encode(serializeSSEPing()));
							} catch {
								// Stream may be closed
								if (pingInterval) clearInterval(pingInterval);
							}
						}, PING_INTERVAL_MS);
					},

					cancel() {
						// Cleanup on client disconnect
						if (pingInterval) clearInterval(pingInterval);
						if (unsubscribe) unsubscribe();
					},
				});

				// Handle abort signal for cleanup
				request.signal.addEventListener("abort", () => {
					if (pingInterval) clearInterval(pingInterval);
					if (unsubscribe) unsubscribe();
				});

				return new Response(stream, {
					headers: {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache, no-transform",
						Connection: "keep-alive",
						"X-Accel-Buffering": "no", // Nginx: disable buffering
						"Content-Encoding": "Identity", // Wrangler/miniflare: prevent buffering
					},
				});
			},
		},
	},
});
