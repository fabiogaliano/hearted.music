/**
 * Deck entry: start or resume the Match deck for one orientation (plan §8) and
 * read single deck cards (plan §7), as domain operations the deck server fns
 * call. Entry is hash → probe → miss build → promote, returned as one Result
 * whose `entry` says which branch resolved it.
 */

import { Result, TaggedError } from "better-result";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import {
	DEFAULT_MATCH_STRICTNESS,
	STRICTNESS_MIN_SCORE,
} from "@/lib/domains/taste/song-matching/strictness";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import { captureAheadForSession } from "./card-materializer";
import { SONG_CARD_SUGGESTION_CAP } from "./card-suggestion-caps";
import { findInFlightBuildProposalsJob } from "./deck-jobs";
import {
	activeDeckOrNull,
	callReadMatchDeckCard,
	callStartOrResumeMatchDeck,
	type StartOrResumeMatchDeckRpcResult,
} from "./deck-read-queries";
import {
	captureUnexpectedCardShape,
	deckWindow,
	type MatchDeckBuildingState,
	type MatchDeckView,
	type MatchReviewItemRead,
	mapReadDeckCardToItemRead,
	mapStartOrResumeToView,
} from "./deck-view";
import { buildOneProposal } from "./proposal-builder";
import { enqueueBuildProposals } from "./proposal-rebuild";
import { getOwnedQueueItem } from "./queries";
import type { MatchOrientation } from "./types";
import { resolveVisibilityConfigHash } from "./visibility-config-hash";

/**
 * How an entry resolved. A hit is a live view, either already active or
 * promoted by the miss build; a miss is the building state, either because no
 * snapshot is published yet or because the miss build didn't promote (deferred
 * to the worker, lost a race, or an empty subject set) and self-heals on the
 * next entry.
 */
export type ResolvedMatchDeck =
	| { entry: "active" | "promoted"; view: MatchDeckView }
	| {
			entry: "no_snapshot" | "promotion_incomplete";
			view: MatchDeckBuildingState;
	  };

export type DeckEntry = ResolvedMatchDeck["entry"];

/**
 * "entry" is a /match entry: it hashes up front, since a miss needs the hash.
 * "after_action" re-reads a deck an action just advanced (M10): that session is
 * still active in practice and RPC branch 1 never reads the hash, so it probes
 * with a null hash and only hashes when the probe can't answer.
 */
export type DeckRead = "entry" | "after_action";

/** The step that failed, so the boundary can tag the capture and pick the copy. */
export class DeckEntryError extends TaggedError("DeckEntryError")<{
	step:
		| "visibility_hash"
		| "start_or_resume"
		| "latest_snapshot"
		| "miss_build";
	cause: DbError;
}> {}

/** A card read; `materialized` is set when the cold path (R-E) ran. */
export interface DeckCardRead {
	card: MatchReviewItemRead;
	materialized: {
		recovered: boolean;
		orientation: MatchOrientation | null;
	} | null;
}

const BUILDING: MatchDeckBuildingState = { status: "building" };

/**
 * The one bounded deck read: compute nowMs → hash (from the SAME target filters
 * a proposal build reads) → call the RPC → map, with the miss branches folded in.
 * On a miss with a published snapshot, the approach-X first-window build runs and
 * re-invokes the RPC; with no snapshot at all, the building empty state.
 *
 * One `nowMs` is threaded into the hash AND (on a miss) buildFirstWindowAndPromote
 * so the RPC's branch-2 search key is byte-identical to the built proposal's hash.
 */
export async function resolveMatchDeck(
	accountId: string,
	orientation: MatchOrientation,
	read: DeckRead,
): Promise<Result<ResolvedMatchDeck, DeckEntryError>> {
	const window = deckWindow(orientation);

	if (read === "after_action") {
		const probeResult = await callStartOrResumeMatchDeck(
			accountId,
			orientation,
			null,
			window,
		);
		if (Result.isError(probeResult)) {
			return Result.err(
				new DeckEntryError({
					step: "start_or_resume",
					cause: probeResult.error,
				}),
			);
		}
		const probed = activeDeckOrNull(probeResult.value);
		if (probed && probed.visibilityConfigHash != null) {
			return Result.ok({
				entry: "active",
				view: mapStartOrResumeToView(probed, window),
			});
		}
		// No active session — or a legacy active session whose null-hash probe can't
		// supply visibilityConfigHash — so fall through to the normal path below.
		// A null hash can never satisfy branch 2's exact-match filter, and recomputing
		// the real hash preserves the public contract for the legacy branch-1 case.
	}

	const nowMs = Date.now();
	const hashResult = await resolveVisibilityConfigHash(
		accountId,
		orientation,
		nowMs,
	);
	if (Result.isError(hashResult)) {
		return Result.err(
			new DeckEntryError({ step: "visibility_hash", cause: hashResult.error }),
		);
	}
	const { hash: visibilityConfigHash, minScore } = hashResult.value;

	const rpcResult = await callStartOrResumeMatchDeck(
		accountId,
		orientation,
		visibilityConfigHash,
		window,
	);
	if (Result.isError(rpcResult)) {
		return Result.err(
			new DeckEntryError({ step: "start_or_resume", cause: rpcResult.error }),
		);
	}
	const active = activeDeckOrNull(rpcResult.value);
	if (active) {
		return Result.ok({
			entry: "active",
			view: mapStartOrResumeToView(active, window),
		});
	}

	// Miss. Distinguish "no snapshot at all" (building empty state) from
	// "no ready proposal yet" (approach-X first-window build).
	const snapshotResult = await getLatestMatchSnapshot(accountId);
	if (Result.isError(snapshotResult)) {
		return Result.err(
			new DeckEntryError({
				step: "latest_snapshot",
				cause: snapshotResult.error,
			}),
		);
	}
	if (!snapshotResult.value) {
		return Result.ok({ entry: "no_snapshot", view: BUILDING });
	}

	const builtResult = await buildFirstWindowAndPromote({
		accountId,
		orientation,
		snapshotId: snapshotResult.value.id,
		preset: presetForMinScore(minScore),
		minScore,
		visibilityConfigHash,
		nowMs,
		window,
	});
	if (Result.isError(builtResult)) {
		return Result.err(
			new DeckEntryError({ step: "miss_build", cause: builtResult.error }),
		);
	}
	const promoted = activeDeckOrNull(builtResult.value);
	if (promoted) {
		return Result.ok({
			entry: "promoted",
			view: mapStartOrResumeToView(promoted, window),
		});
	}
	// Still a miss right after building (empty subject set / hash race) → building.
	// The enqueued full build makes the next entry a hit.
	return Result.ok({ entry: "promotion_incomplete", view: BUILDING });
}

/** Reverses STRICTNESS_MIN_SCORE; an unmapped minScore falls back to the default preset. */
function presetForMinScore(minScore: number): string {
	return (
		Object.entries(STRICTNESS_MIN_SCORE).find(([, v]) => v === minScore)?.[0] ??
		DEFAULT_MATCH_STRICTNESS
	);
}

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
 *   2. POST-BUILD RE-CHECK, then RE-INVOKE start_or_resume_match_deck with the
 *      SAME visibilityConfigHash. A worker `build_proposals` job for this
 *      (account, orientation) can be enqueued+claimed AFTER the step-0 check but
 *      DURING the inline `buildOneProposal` above, mid-run against the SAME key:
 *      this request flips its proposal `ready` while the worker sits between its
 *      subject DELETE and re-INSERT, so promoting our own re-invoke here could
 *      publish a zero/partial subject set into a DURABLE session — and because
 *      promotion writes the match_review_session_snapshot ledger row,
 *      append_sessions for the same (snapshot, hash) short-circuits on the
 *      already-applied key and never backfills, so the truncated session would
 *      persist until the next snapshot publish. So re-run
 *      `findInFlightBuildProposalsJob` FIRST: if a job now exists, defer to the
 *      worker exactly like step 0 (keep the best-effort enqueue, return the miss
 *      unchanged — the caller maps it to `{status:"building"}` and the client's
 *      bounded poll re-reads once the worker finishes); a lookup failure fails
 *      OPEN (captured, then falls through to the re-invoke). Otherwise re-invoke:
 *      buildOneProposal derives its own hash from the same target filters + the
 *      same `nowMs` the caller hashed with, so branch-2 promotion normally finds
 *      the just-built ready proposal within this request — but this is NOT
 *      guaranteed: a filter change racing between the request's hash read and the
 *      builder's own filters read can skew the hash, producing a transient miss
 *      here that self-heals on the next entry (recorded in the decisions log).
 *      The re-check shrinks the promotion window from "the whole inline build
 *      duration" to "a job enqueued+claimed AND its upsert+DELETE completing
 *      entirely inside the flip→re-check gap (a few ms)". The residual class
 *      the re-check can't reach — any OTHER concurrent reader, or a worker
 *      crash, promoting mid-rewrite without passing through this handler — is
 *      now closed DB-side: branch-2 promotion in start_or_resume_match_deck
 *      gates on `total_subjects` equalling the live subject row count
 *      (migration 20260707000019), so a `ready` proposal mid-rewrite is
 *      rejected at the promotion site itself and falls into the same miss.
 *   3. Best-effort enqueue the full `build_proposals` (all presets) so the next
 *      entry after a preset change is a hit. A failure here never fails the
 *      request — the snapshot is durable and the read path self-heals.
 *
 * The request-path hash must still match the builder hash; promotion integrity
 * is guarded in SQL by start_or_resume_match_deck's subject-count predicate.
 */
async function buildFirstWindowAndPromote(input: {
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
		const enqueued = await enqueueBuildProposals({
			accountId,
			orientation,
			snapshotId,
			visibilityConfigHash,
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
	//    would race the SAME build unserialized (see this function's docstring).
	//    A lookup failure fails OPEN: fall through to the inline build rather
	//    than fail the request over a best-effort check.
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

	// 2a. Post-build re-check: a worker build_proposals job for this (account,
	//     orientation) can be enqueued+claimed AFTER the step-0 check but DURING
	//     the inline buildOneProposal above, mid-run against the SAME key. If one
	//     appeared, do NOT promote our own re-invoke — it could publish a
	//     zero/partial subject set into a durable session while the worker is
	//     between its subject DELETE and re-INSERT, and the snapshot-applied ledger
	//     would then short-circuit any later backfill for the same (snapshot, hash)
	//     until the next publish. Defer to the worker exactly like step 0. Fails
	//     OPEN identically: a lookup DB error is captured and falls through to the
	//     re-invoke rather than failing the request over a best-effort check.
	const postBuildInFlight = await findInFlightBuildProposalsJob(
		accountId,
		orientation,
	);
	if (Result.isError(postBuildInFlight)) {
		captureServerError(postBuildInFlight.error, {
			area: "match_review_queue",
			operation: "match_deck_miss_post_build_check",
			accountId,
			extra: { orientation, snapshotId },
		});
	} else if (postBuildInFlight.value !== null) {
		await enqueueFullBuild();
		return Result.ok(MISS_RESULT);
	}

	// 2b. Re-invoke: a ready proposal now exists for this exact hash → branch-2
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

// ============================================================================
// Single card reads — pure read + on-demand materialize fallback (R-E)
// ============================================================================

function reportDeckError(
	error: unknown,
	operation: string,
	accountId: string,
	extra?: Record<string, unknown>,
): void {
	captureServerError(error, {
		area: "match_review_queue",
		operation,
		accountId,
		extra,
	});
}

/**
 * Loads the owning session/orientation/position for a not-captured card and
 * captures just this one item (reusing captureAheadForSession, window 1) so the
 * re-read finds pairs. Best-effort: a capture failure still lets the re-read
 * surface the not_captured fallback rather than throwing.
 */
async function materializeOnDemand(
	accountId: string,
	itemId: string,
): Promise<{ orientation: MatchOrientation } | null> {
	const itemResult = await getOwnedQueueItem(accountId, itemId);
	if (Result.isError(itemResult)) {
		reportDeckError(
			itemResult.error,
			"read_match_deck_card_load_item",
			accountId,
			{ itemId },
		);
		return null;
	}
	const item = itemResult.value;
	if (!item) return null;
	const orientation = item.subject.orientation;

	const captureResult = await captureAheadForSession({
		accountId,
		sessionId: item.sessionId,
		orientation,
		fromPosition: item.position,
		window: 1,
	});
	if (Result.isError(captureResult)) {
		reportDeckError(
			captureResult.error,
			"read_match_deck_card_materialize",
			accountId,
			{ itemId, orientation },
		);
	}
	return { orientation };
}

/**
 * Reads one deck card (plan §7) by item id. A card the worker hasn't captured
 * yet is materialized on demand and re-read once (R-E); every failure degrades
 * to the retryable card rather than an error.
 */
export async function resolveDeckCard(
	accountId: string,
	itemId: string,
): Promise<DeckCardRead> {
	// Orientation is unknown up front (itemId only), so read the whole capped set
	// (both caps are 100) — never truncates either arm; nextCursor stays null.
	const window = SONG_CARD_SUGGESTION_CAP;

	const firstResult = await callReadMatchDeckCard(
		itemId,
		accountId,
		window,
		true,
	);
	if (Result.isError(firstResult)) {
		reportDeckError(firstResult.error, "read_match_deck_card", accountId, {
			itemId,
		});
		return {
			card: {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			},
			materialized: null,
		};
	}

	const first = firstResult.value;
	captureUnexpectedCardShape(accountId, itemId, first);
	if (first.status !== "not_captured") {
		// Orientation only feeds the no_visible_suggestions copy, and that payload
		// doesn't carry it — null → orientation-neutral copy (never a mislabel).
		return {
			card: mapReadDeckCardToItemRead(first, itemId, window, null),
			materialized: null,
		};
	}

	// R-E cold path: worker hasn't captured ahead yet — materialize this one item
	// and re-read ONCE. Still not_captured → the mapper's retryable fallback.
	const materialized = await materializeOnDemand(accountId, itemId);

	let coldResult: MatchReviewItemRead;
	let recovered = false;
	if (!materialized) {
		coldResult = mapReadDeckCardToItemRead(first, itemId, window, null);
	} else {
		const secondResult = await callReadMatchDeckCard(
			itemId,
			accountId,
			window,
			true,
		);
		if (Result.isError(secondResult)) {
			reportDeckError(
				secondResult.error,
				"read_match_deck_card_recapture",
				accountId,
				{ itemId, orientation: materialized.orientation },
			);
			coldResult = {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			};
		} else {
			captureUnexpectedCardShape(accountId, itemId, secondResult.value);
			recovered = secondResult.value.status !== "not_captured";
			// The re-read may now resolve to no_visible_suggestions; materialize gave
			// us the real orientation, so the copy names the correct suggestion side.
			coldResult = mapReadDeckCardToItemRead(
				secondResult.value,
				itemId,
				window,
				materialized.orientation,
			);
		}
	}

	return {
		card: coldResult,
		materialized: {
			recovered,
			orientation: materialized?.orientation ?? null,
		},
	};
}
