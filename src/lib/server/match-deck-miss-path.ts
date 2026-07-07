/**
 * Request-path miss handler for start_or_resume_match_deck (plan §8 step 3,
 * orchestrator ruling R-B "approach X").
 *
 * When the RPC reports a miss but a published snapshot exists (fresh deploy /
 * preset change / midnight filter rollover), we self-heal in-request:
 *
 *   0. Defer to the worker if it's already on it (P0 race fix, verification
 *      pass 2). A snapshot publish enqueues a `build_proposals` job before the
 *      user's request can even reach this handler; building inline here too
 *      would run `buildOneProposal`'s five non-transactional PostgREST calls
 *      concurrently with the worker's run of the SAME build, unserialized
 *      (the queue's per-(account,orientation) NOT EXISTS guard in
 *      `claim_pending_match_review_deck_job` never sees a request-path build,
 *      since this path never goes through the queue). Interleaved, one
 *      writer's unconditional subject DELETE can wipe the other's just-inserted
 *      rows, tripping the H3 unique indexes or stranding a proposal at
 *      `building` with its subjects gone. So: if a `pending`/`running`
 *      `build_proposals` job already exists for this (account, orientation),
 *      skip the inline build, keep the best-effort enqueue (step 3), and return
 *      the miss unchanged — the caller maps that to `{status:"building"}` and
 *      the client's bounded poll re-reads once the worker finishes. Residual
 *      TOCTOU: a job can still be enqueued between this check and the build
 *      below; accepted deliberately (see decisions log) — this closes the
 *      common publish-window collision, not every interleaving. The job lookup
 *      itself is best-effort too: a lookup failure fails OPEN (falls through to
 *      building) rather than failing the request.
 *   1. Otherwise, synchronously build ONLY the current preset's proposal by
 *      reusing the write-time `buildOneProposal` as-is (upserts the proposal +
 *      subjects, the ≤PROMOTION_SEED_SUBJECTS seed, flips status→ready; it does
 *      NOT supersede other snapshots). Deviation from §8.3's literal "bounded
 *      first-window scan": approach X derives the full current-preset subject
 *      list (≈ the pre-refactor baseline cost, not a true first-window scan) —
 *      accepted because a miss is rare (§13) and self-heals, and the enqueued
 *      full build below makes the next entry a hit. A `unique_violation` here
 *      (the residual race the step-0 check didn't catch — TOCTOU, or a losing
 *      interleaving against some other concurrent writer) degrades to the miss
 *      result instead of propagating: the request path must never surface a
 *      500 for losing this race.
 *   2. RE-INVOKE start_or_resume_match_deck with the SAME visibilityConfigHash.
 *      buildOneProposal derived its own hash from the same target filters + the
 *      same `nowMs` the caller hashed with, so branch-2 promotion is guaranteed
 *      to find the just-built ready proposal within this request.
 *   3. Best-effort enqueue the full `build_proposals` (all presets) so the next
 *      entry after a preset change is a hit. A failure here never fails the
 *      request — the snapshot is durable and the read path self-heals.
 *
 * No new plpgsql. The single load-bearing invariant (request hash ≡ worker
 * proposal hash) is deferred to the local-DB pass.
 */

import { Result } from "better-result";
import {
	enqueueDeckJob,
	findInFlightBuildProposalsJob,
} from "@/lib/domains/taste/match-review-queue/deck-jobs";
import {
	callStartOrResumeMatchDeck,
	type StartOrResumeMatchDeckRpcResult,
} from "@/lib/domains/taste/match-review-queue/deck-read-queries";
import { buildOneProposal } from "@/lib/domains/taste/match-review-queue/proposal-builder";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";

/** Postgres SQLSTATE for unique_violation (PostgREST/postgrest-js passes it through as `error.code`). */
const UNIQUE_VIOLATION_CODE = "23505";

function isUniqueViolation(error: DbError): boolean {
	return error instanceof DatabaseError && error.code === UNIQUE_VIOLATION_CODE;
}

/** The RPC's own miss shape — returned as-is when we defer/degrade instead of building. */
const MISS_RESULT: StartOrResumeMatchDeckRpcResult = {
	status: "miss",
	reason: "no_ready_proposal",
};

export async function buildFirstWindowAndPromote(input: {
	accountId: string;
	orientation: MatchOrientation;
	snapshotId: string;
	preset: string;
	minScore: number;
	visibilityConfigHash: string;
	nowMs: number;
	window?: number;
}): Promise<Result<StartOrResumeMatchDeckRpcResult, DbError>> {
	const {
		accountId,
		orientation,
		snapshotId,
		preset,
		minScore,
		visibilityConfigHash,
		nowMs,
		window,
	} = input;

	// Best-effort: enqueue the full build (all presets) so a later preset change
	// finds a ready proposal instead of re-entering this path. Shared by the
	// step-0 defer branch and the normal build-then-enqueue path below.
	async function enqueueFullBuild(): Promise<void> {
		const enqueued = await enqueueDeckJob({
			accountId,
			orientation,
			kind: "build_proposals",
			idempotencyKey: `build:${accountId}:${orientation}:${snapshotId}:${visibilityConfigHash}`,
			payload: { snapshotId },
		});
		if (Result.isError(enqueued)) {
			captureServerError(enqueued.error, {
				area: "match_review_queue",
				operation: "match_deck_miss_build_enqueue",
				accountId,
				extra: { orientation, snapshotId },
			});
		}
	}

	// 0. Defer to the worker if a build_proposals job for this (account,
	//    orientation) is already pending/running — most commonly the job the
	//    triggering snapshot publish itself enqueued. Building inline here too
	//    would race the SAME build unserialized (see file-header docstring). A
	//    lookup failure fails OPEN: fall through to the inline build rather than
	//    fail the request over a best-effort check.
	const inFlight = await findInFlightBuildProposalsJob(accountId, orientation);
	if (Result.isError(inFlight)) {
		captureServerError(inFlight.error, {
			area: "match_review_queue",
			operation: "match_deck_miss_in_flight_check",
			accountId,
			extra: { orientation, snapshotId },
		});
	} else if (inFlight.value !== null) {
		await enqueueFullBuild();
		return Result.ok(MISS_RESULT);
	}

	// 1. Build the current preset's proposal (seed window included) synchronously.
	const built = await buildOneProposal(
		accountId,
		orientation,
		snapshotId,
		preset,
		minScore,
		nowMs,
	);
	if (Result.isError(built)) {
		// Lost a residual race the step-0 check didn't catch (TOCTOU, or some
		// other concurrent writer): degrade to the miss result instead of
		// surfacing a 500 — the hard requirement from the P0 finding. Any other
		// error class still propagates as a genuine failure.
		if (!isUniqueViolation(built.error)) return built;
		captureServerError(built.error, {
			area: "match_review_queue",
			operation: "match_deck_miss_build_race",
			accountId,
			extra: { orientation, snapshotId },
		});
		await enqueueFullBuild();
		return Result.ok(MISS_RESULT);
	}

	// 2. Re-invoke: a ready proposal now exists for this exact hash → branch-2
	//    promotion returns the active view.
	const reinvoked = await callStartOrResumeMatchDeck(
		accountId,
		orientation,
		visibilityConfigHash,
		window,
	);
	if (Result.isError(reinvoked)) return reinvoked;

	// 3. Best-effort enqueue, then return whatever the re-invoke reported
	//    (active, or a residual miss the caller maps to "building").
	await enqueueFullBuild();
	return reinvoked;
}
