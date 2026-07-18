/**
 * Shared claim-and-dispatch poll loop, factored out of poll.ts,
 * poll-extension-sync.ts, and poll-audio-feature-backfill.ts (2026-07-14
 * architecture-audit follow-up). All three duplicated the same shape:
 * a `shouldPoll` flag + `activeJobs` id set, an inner loop that claims and
 * fires off jobs while under the concurrency cap, and an outer loop that
 * reruns the inner loop on a fixed interval. This module owns that shape;
 * each call site supplies its own claim RPC, per-job dispatch (including its
 * own heartbeat/logging), concurrency source, and poll interval so the
 * pre-refactor timing/backoff of each loop is unchanged.
 *
 * `dispatch` is awaited by the inner loop before it claims again — matching
 * the pre-refactor loops, where the synchronous prelude (resolve actor +
 * log "claimed") ran inline and only the actual job execution was
 * fire-and-forget. A loop whose dispatch has no synchronous prelude (e.g.
 * audio-feature-backfill) simply resolves immediately, kicking off its
 * fire-and-forget task without blocking the next claim.
 */

import type { Result } from "better-result";
import { Result as ResultNs } from "better-result";

export interface PollLoopOptions<TJob, TError extends { message: string }> {
	/** Current concurrency cap; read fresh on every claim to allow live config. */
	concurrency: () => number;
	claim: () => Promise<Result<TJob | null, TError>>;
	jobId: (job: TJob) => string;
	onClaimError: (error: TError) => void;
	/**
	 * Runs the synchronous prelude for a claimed job (if any) and kicks off its
	 * execution. Must call `markDone()` once the job is no longer active
	 * (typically in a `finally` inside a fire-and-forget task).
	 */
	dispatch: (job: TJob, markDone: () => void) => void | Promise<void>;
	pollIntervalMs: number;
	onLoopStart?: () => void;
	onLoopStop?: () => void;
}

export interface PollLoop {
	stop: () => void;
	getActiveCount: () => number;
	/** Drains claims while under the concurrency cap; returns once empty/error/full. */
	claimAndDispatch: () => Promise<void>;
	/** Runs claimAndDispatch on a fixed interval until stopped. */
	start: () => Promise<void>;
}

export function createPollLoop<TJob, TError extends { message: string }>(
	options: PollLoopOptions<TJob, TError>,
): PollLoop {
	let shouldPoll = true;
	const activeJobs = new Set<string>();

	function stop() {
		shouldPoll = false;
	}

	function getActiveCount() {
		return activeJobs.size;
	}

	async function claimAndDispatch(): Promise<void> {
		while (shouldPoll && activeJobs.size < options.concurrency()) {
			const claimResult = await options.claim();
			if (ResultNs.isError(claimResult)) {
				options.onClaimError(claimResult.error);
				return;
			}

			const job = claimResult.value;
			if (!job) return;

			const id = options.jobId(job);
			activeJobs.add(id);
			await options.dispatch(job, () => activeJobs.delete(id));
		}
	}

	async function start(): Promise<void> {
		shouldPoll = true;
		options.onLoopStart?.();

		while (shouldPoll) {
			await claimAndDispatch();
			await Bun.sleep(options.pollIntervalMs);
		}

		options.onLoopStop?.();
	}

	return { stop, getActiveCount, claimAndDispatch, start };
}
