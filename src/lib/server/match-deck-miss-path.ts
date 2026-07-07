/**
 * Request-path miss handler for start_or_resume_match_deck (plan §8 step 3,
 * orchestrator ruling R-B "approach X").
 *
 * When the RPC reports a miss but a published snapshot exists (fresh deploy /
 * preset change / midnight filter rollover), we self-heal in-request:
 *
 *   1. Synchronously build ONLY the current preset's proposal by reusing the
 *      write-time `buildOneProposal` as-is (upserts the proposal + subjects, the
 *      ≤PROMOTION_SEED_SUBJECTS seed, flips status→ready; it does NOT supersede
 *      other snapshots). Deviation from §8.3's literal "bounded first-window
 *      scan": approach X derives the full current-preset subject list (≈ the
 *      pre-refactor baseline cost, not a true first-window scan) — accepted
 *      because a miss is rare (§13) and self-heals, and the enqueued full build
 *      below makes the next entry a hit.
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
import { enqueueDeckJob } from "@/lib/domains/taste/match-review-queue/deck-jobs";
import {
	callStartOrResumeMatchDeck,
	type StartOrResumeMatchDeckRpcResult,
} from "@/lib/domains/taste/match-review-queue/deck-read-queries";
import { buildOneProposal } from "@/lib/domains/taste/match-review-queue/proposal-builder";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import { captureServerError } from "@/lib/observability/capture-server-error";
import type { DbError } from "@/lib/shared/errors/database";

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

	// 1. Build the current preset's proposal (seed window included) synchronously.
	const built = await buildOneProposal(
		accountId,
		orientation,
		snapshotId,
		preset,
		minScore,
		nowMs,
	);
	if (Result.isError(built)) return built;

	// 2. Re-invoke: a ready proposal now exists for this exact hash → branch-2
	//    promotion returns the active view.
	const reinvoked = await callStartOrResumeMatchDeck(
		accountId,
		orientation,
		visibilityConfigHash,
		window,
	);
	if (Result.isError(reinvoked)) return reinvoked;

	// 3. Best-effort: enqueue the full build (all presets) so a later preset
	//    change finds a ready proposal instead of re-entering this path.
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

	return reinvoked;
}
