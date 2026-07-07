/**
 * Poll loop + stale-lease sweep for match-review deck jobs.
 *
 * Runs as its own loop with a dedicated claim RPC (structural clone of
 * poll-audio-feature-backfill.ts). Concurrency is 1 and the claim is p_limit=1:
 * the claim function serializes per (account, orientation) only against committed
 * running rows, so a single-slot poller is the safe drain shape (decisions log,
 * Phase 1a).
 *
 * Dispatch by kind:
 *  - build_proposals / repair → build proposals for all presets, then chain an
 *    append_sessions job (R2: publish → build → append).
 *  - append_sessions → append newly-visible proposal subjects to the active
 *    session; a not-yet-ready proposal defers for a retry.
 *  - capture_ahead → capture the next deck window off the swiper's path.
 *
 * Settlement is by direct UPDATE (no settlement RPC exists): completeDeckJob on
 * success, deferDeckJob on a returned error or a throw. Every handler is
 * idempotent, so a sweep-resurrected double-run converges.
 */

import * as Sentry from "@sentry/bun";
import { Result } from "better-result";
import type { Json } from "@/lib/data/database.types";
import {
	CAPTURE_AHEAD_WINDOW,
	captureAheadForSession,
	readSessionResumePosition,
} from "@/lib/domains/taste/match-review-queue/card-materializer";
import {
	claimDeckJob,
	completeDeckJob,
	type DeckJob,
	deferDeckJob,
	enqueueDeckJob,
	heartbeatDeckJob,
	markDeadDeckJobs,
	sweepStaleDeckJobs,
} from "@/lib/domains/taste/match-review-queue/deck-jobs";
import { buildProposalsForAccountOrientation } from "@/lib/domains/taste/match-review-queue/proposal-builder";
import { appendSessionsForAccountOrientation } from "@/lib/domains/taste/match-review-queue/session-appender";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import { log } from "@/lib/observability/logger";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import { workerConfig } from "./config";
import { captureWorkerEvent } from "./posthog-capture";

// Bounded retry backoff for a deferred job; attempts were already consumed at
// claim, so mark_dead terminalizes after max_attempts regardless of this delay.
const DEFER_BACKOFF_SECONDS = 30;

// Shared with mark_dead (H1): a 'running' job only dead-letters once its
// heartbeat is older than this same lease, so sweep's reclaim and mark_dead's
// dead-letter agree on what "still running" means and a job on its final
// attempt is never marked dead while still genuinely executing.
const DECK_JOB_LEASE_SECONDS = 900;

let shouldPoll = false;
const activeJobs = new Set<string>();

export function stopMatchDeckJobPolling(): void {
	shouldPoll = false;
}

export function getActiveMatchDeckJobCount(): number {
	return activeJobs.size;
}

function toOrientation(value: string): MatchOrientation | null {
	return value === "song" || value === "playlist" ? value : null;
}

function payloadSnapshotId(payload: Json): string | null {
	if (payload && typeof payload === "object" && !Array.isArray(payload)) {
		const value = (payload as Record<string, Json | undefined>).snapshotId;
		if (typeof value === "string") return value;
	}
	return null;
}

/**
 * Worker lag metric (§13). `job.created_at` is set when the job is enqueued —
 * for build_proposals that is immediately after snapshot publish (execute.ts R2
 * / miss / filter rewire), and for capture_ahead it is in-txn with the deck
 * action — so `now - created_at` is a close proxy for publish→ready and
 * action→captured latency. Best-effort: captureWorkerEvent already no-ops
 * outside production, and a metric must never fail the settled job.
 */
function emitDeckJobLag(
	event: string,
	job: DeckJob,
	properties: Record<string, unknown>,
): void {
	const createdMs = Date.parse(job.created_at);
	if (Number.isNaN(createdMs)) return;
	captureWorkerEvent({
		distinctId: job.account_id,
		event,
		properties: {
			lag_ms: Math.max(0, Date.now() - createdMs),
			kind: job.kind,
			...properties,
		},
	});
}

async function dispatchDeckJob(job: DeckJob): Promise<Result<void, DbError>> {
	const orientation = toOrientation(job.orientation);
	if (!orientation) {
		return Result.err(
			new DatabaseError({
				code: "bad_orientation",
				message: `deck job ${job.id} has unknown orientation ${job.orientation}`,
			}),
		);
	}

	switch (job.kind) {
		case "build_proposals":
		case "repair": {
			let snapshotId = payloadSnapshotId(job.payload);
			if (!snapshotId && job.kind === "repair") {
				const latest = await getLatestMatchSnapshot(job.account_id);
				if (Result.isError(latest)) return latest;
				if (!latest.value) return Result.ok(undefined);
				snapshotId = latest.value.id;
			}
			if (!snapshotId) {
				return Result.err(
					new DatabaseError({
						code: "missing_snapshot",
						message: `${job.kind} job ${job.id} has no snapshotId in payload`,
					}),
				);
			}

			const built = await buildProposalsForAccountOrientation({
				accountId: job.account_id,
				orientation,
				snapshotId,
			});
			if (Result.isError(built)) {
				// Explicit capture of a proposal-build failure. The builder is shared
				// domain code that can't import a Sentry SDK without cross-contaminating
				// the CF and worker bundles, so the capture lives here at the worker
				// dispatch boundary; the request-path invocation (the miss handler) is
				// already captured by captureServerError in resolveMatchDeckView.
				Sentry.captureException(built.error, {
					tags: {
						area: "match_deck",
						operation: "build_proposals",
						runtime: "worker",
						kind: job.kind,
					},
					extra: {
						accountId: job.account_id,
						jobId: job.id,
						orientation,
						snapshotId,
					},
				});
				return built;
			}

			// Lag metric: publish → proposals ready.
			emitDeckJobLag("match_deck_build_lag", job, { orientation, snapshotId });

			// R2: chain append_sessions once proposals are ready. Idempotency key is
			// per-snapshot so a rebuild re-enqueues the same append at most once.
			const chained = await enqueueDeckJob({
				accountId: job.account_id,
				orientation,
				kind: "append_sessions",
				idempotencyKey: `append:${job.account_id}:${orientation}:${snapshotId}`,
				payload: { snapshotId } as Json,
			});
			if (Result.isError(chained)) return chained;
			return Result.ok(undefined);
		}

		case "append_sessions": {
			const snapshotId = payloadSnapshotId(job.payload);
			if (!snapshotId) {
				return Result.err(
					new DatabaseError({
						code: "missing_snapshot",
						message: `append_sessions job ${job.id} has no snapshotId in payload`,
					}),
				);
			}
			const outcome = await appendSessionsForAccountOrientation({
				accountId: job.account_id,
				orientation,
				snapshotId,
			});
			if (Result.isError(outcome)) return outcome;
			// Proposal missing (never built / raced ahead of its build): defer for a
			// retry. A `superseded` outcome (a newer snapshot's publish marked this
			// older snapshot's proposal stale) is a CORRECT skip — fall through to
			// complete, so it never dead-letters and never emits Sentry (M2).
			if (outcome.value.kind === "no_ready_proposal") {
				return Result.err(
					new DatabaseError({
						code: "no_ready_proposal",
						message: `append_sessions job ${job.id}: proposal not ready yet`,
					}),
				);
			}
			// Worker-side replacement for the deleted request-path
			// `review_queue_appended` (Phase 5 removed emitQueueAppendEvents with the
			// synchronous append). Emit only when items actually landed so the
			// appended_count signal survives the move to the worker.
			if (outcome.value.kind === "applied" && outcome.value.appendedCount > 0) {
				captureWorkerEvent({
					distinctId: job.account_id,
					event: "review_queue_appended",
					properties: {
						orientation,
						snapshot_id: snapshotId,
						appended_count: outcome.value.appendedCount,
					},
				});
			}
			return Result.ok(undefined);
		}

		case "capture_ahead": {
			// Sessionless capture jobs are a no-op (only session-scoped work here).
			if (!job.session_id) return Result.ok(undefined);
			const resumeResult = await readSessionResumePosition(job.session_id);
			if (Result.isError(resumeResult)) return resumeResult;
			const captured = await captureAheadForSession({
				accountId: job.account_id,
				sessionId: job.session_id,
				orientation,
				fromPosition: resumeResult.value ?? 0,
				window: CAPTURE_AHEAD_WINDOW,
			});
			if (Result.isError(captured)) return captured;

			// Lag metric: action → next-window captured.
			emitDeckJobLag("match_deck_capture_lag", job, { orientation });
			return Result.ok(undefined);
		}

		default:
			return Result.err(
				new DatabaseError({
					code: "unknown_kind",
					message: `deck job ${job.id} has unknown kind ${job.kind}`,
				}),
			);
	}
}

// A settlement UPDATE (complete/defer) can itself fail. Control flow is
// unchanged — the stale-lease sweep still reclaims the job — but log it so a
// job that lingers until its lease is diagnosable rather than silent.
function logSettlementFailure(
	settlement: "complete" | "defer",
	job: DeckJob,
	result: Result<void, DbError>,
): void {
	if (Result.isError(result)) {
		log.error("match-deck-settlement-write-failed", {
			settlement,
			jobId: job.id,
			kind: job.kind,
			error: result.error.message,
		});
	}
}

export async function startMatchDeckJobPolling(): Promise<void> {
	shouldPoll = true;
	log.info("match-deck-polling-start", {});

	while (shouldPoll) {
		if (activeJobs.size >= 1) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const claimResult = await claimDeckJob();
		if (Result.isError(claimResult)) {
			log.error("match-deck-claim-error", { error: claimResult.error.message });
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		const job = claimResult.value;
		if (!job) {
			await Bun.sleep(workerConfig.pollIntervalMs);
			continue;
		}

		activeJobs.add(job.id);
		void (async () => {
			const heartbeat = setInterval(() => {
				void heartbeatDeckJob(job.id).then((result) => {
					if (Result.isError(result)) {
						log.warn("match-deck-heartbeat-failed", {
							jobId: job.id,
							error: result.error.message,
						});
					}
				});
			}, workerConfig.heartbeatIntervalMs);

			try {
				const outcome = await dispatchDeckJob(job);
				if (Result.isError(outcome)) {
					log.warn("match-deck-job-deferred", {
						jobId: job.id,
						kind: job.kind,
						error: outcome.error.message,
					});
					const deferred = await deferDeckJob(job.id, DEFER_BACKOFF_SECONDS);
					logSettlementFailure("defer", job, deferred);
				} else {
					log.info("match-deck-job-settled", {
						jobId: job.id,
						kind: job.kind,
						accountId: job.account_id,
						orientation: job.orientation,
					});
					const completed = await completeDeckJob(job.id);
					logSettlementFailure("complete", job, completed);
				}
			} catch (err) {
				log.error("match-deck-job-threw", {
					jobId: job.id,
					error: errorMessage(err),
				});
				Sentry.captureException(err, { tags: { loop: "match-deck-jobs" } });
				const deferred = await deferDeckJob(job.id, DEFER_BACKOFF_SECONDS);
				logSettlementFailure("defer", job, deferred);
			} finally {
				clearInterval(heartbeat);
				activeJobs.delete(job.id);
			}
		})();
	}

	log.info("match-deck-polling-stopped", {});
}

export async function runMatchDeckJobSweepTick(): Promise<void> {
	const swept = await sweepStaleDeckJobs(DECK_JOB_LEASE_SECONDS);
	if (Result.isError(swept)) {
		log.error("match-deck-sweep-error", { error: swept.error.message });
	} else if (swept.value.length > 0) {
		log.warn("match-deck-swept-stale-jobs", {
			count: swept.value.length,
			jobIds: swept.value.map((j) => j.id),
		});
	}

	const dead = await markDeadDeckJobs(DECK_JOB_LEASE_SECONDS);
	if (Result.isError(dead)) {
		log.error("match-deck-mark-dead-error", { error: dead.error.message });
		return;
	}
	for (const job of dead.value) {
		log.error("match-deck-job-dead-lettered", {
			jobId: job.id,
			kind: job.kind,
			accountId: job.account_id,
			orientation: job.orientation,
		});
		Sentry.captureMessage(`match deck job dead-lettered: ${job.kind}`, "error");
	}
}

export function startMatchDeckJobSweep(): { stop: () => void } {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	const scheduleNext = () => {
		if (stopped) return;
		timer = setTimeout(() => {
			void runMatchDeckJobSweepTick()
				.catch((error) => {
					log.error("match-deck-sweep-tick-threw", {
						error: errorMessage(error),
					});
					Sentry.captureException(error, {
						tags: { phase: "match-deck-sweep" },
					});
				})
				.finally(scheduleNext);
		}, workerConfig.sweepIntervalMs);
	};

	scheduleNext();
	return {
		stop: () => {
			stopped = true;
			if (timer !== null) clearTimeout(timer);
		},
	};
}
