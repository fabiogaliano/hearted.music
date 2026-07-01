import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { captureVisiblePairsAtomic } from "@/lib/domains/taste/match-review-queue/capture-visible-pairs";
import {
	addQueueItemDecisionAtomically,
	clearSongNewness,
	dismissQueueItemAtomically,
	fetchActiveSession,
	fetchQueueItems,
	finishQueueItemAtomically,
	mapItemToDto,
} from "@/lib/domains/taste/match-review-queue/queries";
import {
	createOrResumeQueue,
	getOrderedUndecidedPlaylistIds,
	getOrderedUndecidedSongIds,
	getQueueSummary,
	markItemPresented,
	syncActiveQueue,
} from "@/lib/domains/taste/match-review-queue/service";
import type {
	MatchOrientation,
	MatchReviewQueueItemDto,
	MatchReviewSession,
	MatchReviewSubject,
} from "@/lib/domains/taste/match-review-queue/types";
import { computeVisibleSuggestionList } from "@/lib/domains/taste/match-review-queue/visible-suggestion-list";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { chunkedRead } from "@/lib/shared/utils/chunked-read";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";

/** Validates orientation inputs at every queue boundary (D12, every queue boundary takes orientation explicitly). */
export const MatchOrientationSchema = z.enum(["song", "playlist"] as const);

/**
 * The errors thrown out of the queue boundary below intentionally hide DB
 * internals from the client — but until now they hid them from us too: the
 * typed error was dropped, so a failed `/match` reached Sentry only as the
 * generic client-side message, with no code or cause. Capture the error (tag +
 * underlying PostgREST/PG code) before translating it, so the next failure is
 * diagnosable server-side instead of requiring a manual repro.
 */
function reportQueueError(
	error: unknown,
	operation: string,
	context: { accountId: string; orientation: MatchOrientation },
): void {
	captureServerError(error, {
		area: "match_review_queue",
		operation,
		accountId: context.accountId,
		extra: { orientation: context.orientation },
	});
}

import { getPreferredMatchViewMode } from "@/lib/domains/library/accounts/preferences-queries";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import { captureProductEventBestEffort } from "@/lib/observability/capture-product-event";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { fetchSongOrientationData } from "./match-review-queue.read";
import { emitQueueAppendEvents } from "./match-review-queue-events";
import type {
	MatchingPlaylistForReview,
	MatchingPlaylistMatch,
	MatchingSong,
	MatchingSongSuggestion,
} from "./matching.functions";

const NoInputSchema = z.undefined();

/**
 * Max suggestion songs shown on a single playlist-orientation review card (P2).
 *
 * One hub playlist can match hundreds of eligible songs; SongSuggestionsSection
 * renders them unvirtualized, so payload, JSON parse, and DOM cost all scale with
 * the raw count (the ~845-suggestion pathological card). The cap is applied to the
 * card's captured suggestion set BEFORE capture, so the visible-pair rows the
 * finish/dismiss RPCs read are exactly the top-N the user could actually see and
 * act on — decisions never touch a suggestion off the bottom of the list. Ordering
 * is deterministic (visibleRank asc from the derivation), so the same top N is
 * shown across retries. Song mode is naturally small (target playlists per song),
 * so it is left uncapped. Product tradeoff: a playlist's lower-ranked song matches
 * are deferred to a later pass rather than shown on one giant card.
 */
const PLAYLIST_CARD_SUGGESTION_CAP = 100;

// Typed item read result — co-located because it is owned by this file's read
// path and nothing outside Phase 3 currently consumes it.
export type MatchReviewItemRead =
	| {
			status: "ready";
			itemId: string;
			// Song orientation: review subject is a song; suggestions are playlists.
			mode: "song";
			reviewItem: MatchingSong;
			suggestions: MatchingPlaylistMatch[];
	  }
	| {
			status: "ready";
			itemId: string;
			// Playlist orientation: review subject is a playlist; suggestions are songs.
			mode: "playlist";
			reviewItem: MatchingPlaylistForReview;
			suggestions: MatchingSongSuggestion[];
	  }
	| {
			status: "unavailable";
			itemId: string;
			reason:
				| "not-entitled"
				| "missing-song"
				| "snapshot-not-owned"
				| "no-visible-suggestions"
				| "already-resolved";
			message: string;
	  }
	| {
			status: "retryable-error";
			itemId: string;
			message: string;
	  };

export interface MatchReviewStartResult {
	sessionId: string;
	/** Ordered queue item ids the client bootstrap query uses to seed the card stack. */
	itemIds: string[];
	/**
	 * The first card the stack will actually land on: the lowest-position item still
	 * in a reviewable state, or null when caught up. Computed with the SAME predicate
	 * as the client's deriveUnresolvedIds (pending|active, position-sorted) so the
	 * route can warm exactly that card's present() capture the instant bootstrap
	 * resolves — without inferring it from itemIds[0], which is the raw head item and
	 * can be already-resolved on a resumed session.
	 */
	firstUnresolvedItemId: string | null;
	total: number;
	caughtUp: boolean;
	/**
	 * The complete queue-list payload for `matchReviewKeys.review(accountId,
	 * orientation)`, built from the SAME queue read the bootstrap already performed.
	 * The bootstrap query seeds this into the review cache so the subsequent
	 * `matchReviewQueryOptions` suspense query resolves from cache instead of firing
	 * a second `getMatchReview` round-trip — collapsing the bootstrap → queue
	 * waterfall and removing the duplicate `fetchQueueItems` read (P0).
	 */
	review: MatchReviewResult;
}

export interface MatchReviewResult {
	sessionId: string;
	items: Array<{
		id: string;
		position: number;
		state: string;
		subject: MatchReviewSubject;
		sourceSnapshotId: string;
	}>;
	total: number;
	/** True when every item is resolved — derived from queue state, not null song. */
	caughtUp: boolean;
	/**
	 * Entitled, undecided review subjects (songs in song mode, playlists in
	 * playlist mode) whose only matches sit below the user's strictness bar. Only
	 * computed on the caught-up path (where the empty state needs it to choose
	 * between the "loosen strictness" nudge and "nothing surfaced"); 0 otherwise.
	 * Orientation-aware so the playlist-mode empty state counts playlists, not
	 * songs (A7, H9).
	 */
	hiddenReviewItemCount: number;
}

export interface MatchReviewItemPresentedResult {
	success: boolean;
	itemId: string;
	state: string;
}

/**
 * Loads the queue item only when it exists AND belongs to the account.
 * Returns null for a missing or foreign item — callers must not leak any data
 * about items they don't own.
 *
 * Uses mapItemToDto so the returned DTO carries a MatchReviewSubject
 * discriminated union instead of the legacy nullable song_id field. Invalid
 * subject rows (wrong orientation vs column) throw rather than returning null,
 * so ownership-verified callers always get a typed shape or a hard error.
 */
async function fetchOwnedQueueItem(
	itemId: string,
	accountId: string,
	operation: string,
): Promise<MatchReviewQueueItemDto | null> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("match_review_queue_item")
		.select("*")
		.eq("id", itemId)
		.eq("account_id", accountId)
		.maybeSingle();

	if (error) {
		// `.maybeSingle()` returns a null error for a real no-row/foreign-item miss,
		// so a truthy error is an operational read failure on the ownership check —
		// capture it before collapsing into the same null callers treat as not-found.
		// Orientation is unknown here (it lives on the row this read failed to load),
		// so this uses captureServerError directly rather than reportQueueError.
		captureServerError(error, {
			area: "match_review_queue",
			operation,
			accountId,
			extra: { itemId },
		});
		return null;
	}
	if (!data) return null;

	return mapItemToDto(data);
}

/** Derived from unresolved item count — never from null song data. */
function deriveCaughtUp(items: MatchReviewQueueItemDto[]): boolean {
	return items.every((item) => item.state === "resolved");
}

/**
 * Eligible-but-hidden review subject count for a caught-up session, computed
 * against the session's FROZEN strictness bar (not the live preference) so the
 * caught-up empty state counts against the exact policy the queue and cards used.
 * Orientation-aware: song mode counts hidden songs, playlist mode hidden
 * playlists. Returns 0 when there is no snapshot or the ordering read fails, so a
 * transient failure degrades to the neutral "nothing surfaced" empty state rather
 * than a wrong "loosen strictness" nudge.
 */
async function computeHiddenReviewItemCount(
	accountId: string,
	activeSession: MatchReviewSession,
): Promise<number> {
	const snapshotResult = await getLatestMatchSnapshot(accountId);
	if (!Result.isOk(snapshotResult) || !snapshotResult.value) return 0;

	if (activeSession.orientation === "playlist") {
		const ordered = await getOrderedUndecidedPlaylistIds(
			snapshotResult.value.id,
			accountId,
			activeSession.strictnessMinScore,
		);
		return Result.isOk(ordered) ? ordered.value.hiddenReviewItemCount : 0;
	}
	const ordered = await getOrderedUndecidedSongIds(
		snapshotResult.value.id,
		accountId,
		activeSession.strictnessMinScore,
	);
	return Result.isOk(ordered) ? ordered.value.hiddenReviewItemCount : 0;
}

/**
 * Builds the authoritative `MatchReviewResult` for an active session from its
 * already-fetched queue items. Both `getMatchReview` (the refetch-after-
 * invalidation path) and `startOrResumeMatchReview` (the bootstrap seed) build
 * their queue payload here, so the list the client renders can't drift between
 * the two entry points. `hiddenReviewItemCount` is computed only on the caught-up
 * path — mirroring what `getMatchReview` did inline — so the active-review hot
 * path never pays for the extra snapshot read.
 */
async function buildMatchReviewResult(
	activeSession: MatchReviewSession,
	items: MatchReviewQueueItemDto[],
	accountId: string,
): Promise<MatchReviewResult> {
	const caughtUp = deriveCaughtUp(items);
	const hiddenReviewItemCount = caughtUp
		? await computeHiddenReviewItemCount(accountId, activeSession)
		: 0;

	return {
		sessionId: activeSession.id,
		items: items.map((item) => ({
			id: item.id,
			position: item.position,
			state: item.state,
			subject: item.subject,
			sourceSnapshotId: item.sourceSnapshotId,
		})),
		total: items.length,
		caughtUp,
		hiddenReviewItemCount,
	};
}

/** Empty queue-list payload for the no-active-session / no-snapshot paths. */
const EMPTY_MATCH_REVIEW_RESULT: MatchReviewResult = {
	sessionId: "",
	items: [],
	total: 0,
	caughtUp: true,
	hiddenReviewItemCount: 0,
};

const StartMatchReviewSchema = z.object({
	orientation: MatchOrientationSchema,
});

/**
 * Creates or resumes the active queue for the authed account and returns the
 * session id + ordered item ids the route loader needs to bootstrap the card
 * stack. Thin wrapper: all queue logic lives in the domain service.
 */
export const startOrResumeMatchReview = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => StartMatchReviewSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewStartResult> => {
		const { session } = context;
		const { orientation } = data;

		const queueResult = await createOrResumeQueue(
			session.accountId,
			orientation,
			{ onVisibleAppend: emitQueueAppendEvents },
		);
		if (Result.isError(queueResult)) {
			reportQueueError(queueResult.error, "create_or_resume_queue", {
				accountId: session.accountId,
				orientation,
			});
			throw new Error(
				"Could not prepare your match review queue. Please try again.",
				{ cause: queueResult.error },
			);
		}

		const activeSession =
			queueResult.value.kind === "no_snapshot"
				? null
				: queueResult.value.session;

		if (!activeSession) {
			// Funnel step 3 (intent → snapshot → review). "no_snapshot" is the
			// drop-off Gabriel hit: intent set, /match opened, but matching hasn't
			// published results yet. Best-effort: the queue prep already succeeded.
			captureProductEventBestEffort({
				distinctId: session.accountId,
				event: "match_review_opened",
				accountId: session.accountId,
				operation: "capture_match_review_opened",
				properties: { orientation, state: "no_snapshot", result_count: 0 },
			});
			return {
				sessionId: "",
				itemIds: [],
				firstUnresolvedItemId: null,
				total: 0,
				caughtUp: true,
				review: EMPTY_MATCH_REVIEW_RESULT,
			};
		}

		const itemsResult = await fetchQueueItems(activeSession.id);
		if (Result.isError(itemsResult)) {
			reportQueueError(itemsResult.error, "fetch_queue_items", {
				accountId: session.accountId,
				orientation,
			});
			throw new Error(
				"Could not load your match review queue. Please try again.",
				{ cause: itemsResult.error },
			);
		}

		const items = itemsResult.value;
		const caughtUp = deriveCaughtUp(items);
		const itemIds = items.map((i) => i.id);
		// Lowest-position reviewable item — the card the stack lands on first. Mirrors
		// the client's deriveUnresolvedIds predicate (pending|active, position-sorted)
		// so the route seeds the correct card even when a resumed session's head item
		// is already resolved. Null when nothing is reviewable (caught up).
		const firstUnresolvedItemId =
			items
				.filter((i) => i.state === "pending" || i.state === "active")
				.sort((a, b) => a.position - b.position)[0]?.id ?? null;

		// Best-effort: the queue is loaded; an analytics failure must not turn this
		// into a failed /match open.
		captureProductEventBestEffort({
			distinctId: session.accountId,
			event: "match_review_opened",
			accountId: session.accountId,
			operation: "capture_match_review_opened",
			properties: {
				orientation,
				state: caughtUp ? "caught_up" : "reviewing",
				result_count: items.length,
			},
		});

		// Build the full queue-list payload from the SAME items just fetched, so the
		// bootstrap query can seed the review cache and the client's queue
		// useSuspenseQuery resolves without a second getMatchReview round-trip (P0).
		const review = await buildMatchReviewResult(
			activeSession,
			items,
			session.accountId,
		);

		return {
			sessionId: activeSession.id,
			itemIds,
			firstUnresolvedItemId,
			total: items.length,
			caughtUp,
			review,
		};
	});

const GetMatchReviewSchema = z.object({
	orientation: MatchOrientationSchema,
});

/**
 * Returns the active session + ordered queue items with enough metadata for
 * the card stack. Caught-up state is derived from item states — never from
 * null song data.
 */
export const getMatchReview = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetMatchReviewSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewResult | null> => {
		const { session } = context;
		const { orientation } = data;

		const sessionResult = await fetchActiveSession(
			session.accountId,
			orientation,
		);
		if (Result.isError(sessionResult)) {
			reportQueueError(sessionResult.error, "fetch_active_session", {
				accountId: session.accountId,
				orientation,
			});
			throw new Error(
				"Could not load your match review queue. Please try again.",
				{ cause: sessionResult.error },
			);
		}

		if (!sessionResult.value) {
			// No active queue: caller should run startOrResumeMatchReview first.
			return EMPTY_MATCH_REVIEW_RESULT;
		}

		const activeSession = sessionResult.value;
		const itemsResult = await fetchQueueItems(activeSession.id);
		if (Result.isError(itemsResult)) {
			reportQueueError(itemsResult.error, "fetch_queue_items", {
				accountId: session.accountId,
				orientation,
			});
			throw new Error(
				"Could not load your match review queue. Please try again.",
				{ cause: itemsResult.error },
			);
		}

		// Shared with startOrResumeMatchReview's bootstrap seed so the two entry
		// points can't drift; hiddenReviewItemCount is computed against the session's
		// frozen strictness bar and only on the caught-up path.
		return buildMatchReviewResult(
			activeSession,
			itemsResult.value,
			session.accountId,
		);
	});

const GetMatchReviewItemSchema = z.object({
	itemId: z.uuid(),
});

/**
 * Side-effect-free prefetch read for a single queue card.
 *
 * Derives the visible suggestion list using song-orientation ranking
 * (match_result_ranking) and returns render-ready song + playlist data ordered
 * by model rank — the same ordering the authoritative capture path produces.
 *
 * Does NOT capture pairs or set item state. Use this only for non-authoritative
 * cache warming of next-in-queue cards (D10). QueueCardContent renders from
 * presentMatchReviewItem, which is the authoritative capture path (D9).
 *
 * Security: song_id and source_snapshot_id are read from the OWNED queue item
 * row — never from client input.
 *
 * Strictness: the SESSION's stored strictness_min_score is used, not a live
 * re-read, so the bar cannot shift on cards the user is already reviewing.
 */
export const getMatchReviewItem = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetMatchReviewItemSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewItemRead> => {
		const { session } = context;
		const { itemId } = data;

		try {
			// Ownership check: load item by id AND account_id in one query. If it
			// doesn't exist or belongs to another account we return an error shape
			// without any indication of whether the item id exists at all.
			const item = await fetchOwnedQueueItem(
				itemId,
				session.accountId,
				"get_match_review_item",
			);
			if (!item) {
				return {
					status: "retryable-error",
					itemId,
					message: "Item not found.",
				};
			}

			// Narrow to song orientation — this server function is song-mode-only.
			// Playlist-mode items return 'missing-song' so the card falls into the
			// unavailable state without leaking orientation details to the UI.
			if (item.subject.orientation !== "song") {
				return {
					status: "unavailable",
					itemId,
					reason: "missing-song",
					message: "This item is not a song review card.",
				};
			}
			const songId = item.subject.songId;

			// Load the session to get the stored strictness score.
			const supabase = createAdminSupabaseClient();
			const { data: sessionRow, error: sessionError } = await supabase
				.from("match_review_session")
				.select("strictness_min_score")
				.eq("id", item.sessionId)
				.eq("account_id", session.accountId)
				.maybeSingle();

			if (sessionError || !sessionRow) {
				// `.maybeSingle()` returns a null error for a no-rows/ownership miss, so a
				// truthy sessionError is always operational — capture it before folding it
				// into the same snapshot-not-owned UI state as a genuine ownership miss.
				if (sessionError) {
					reportQueueError(sessionError, "get_match_review_item", {
						accountId: session.accountId,
						orientation: "song",
					});
				}
				return {
					status: "unavailable",
					itemId,
					reason: "snapshot-not-owned",
					message: "This item's session could not be verified.",
				};
			}

			const strictnessMinScore = sessionRow.strictness_min_score;

			// Derive the visible suggestion list using song-orientation ranking
			// (match_result_ranking). No capture — this is the side-effect-free path.
			// computeVisibleSuggestionList handles entitlement, pair fetch, ranking
			// fetch, and decision exclusion in one call.
			const listResult = await computeVisibleSuggestionList(
				item,
				strictnessMinScore,
			);

			if (listResult.kind === "not-entitled") {
				const message =
					listResult.reason === "song-not-entitled"
						? "This song is no longer available to match."
						: "This playlist is no longer available to match.";
				return {
					status: "unavailable",
					itemId,
					reason: "not-entitled",
					message,
				};
			}

			if (listResult.kind === "db-error") {
				// Operational DB failure deriving the suggestion list. The outer catch
				// only sees throws; this is a returned Result, so capture it here. The
				// function has already narrowed to song orientation above.
				reportQueueError(listResult.error, "get_match_review_item", {
					accountId: session.accountId,
					orientation: "song",
				});
				return {
					status: "retryable-error",
					itemId,
					message: "Could not load match data for this song.",
				};
			}

			const { list } = listResult;

			if (list.suggestions.length === 0) {
				return {
					status: "unavailable",
					itemId,
					reason: "no-visible-suggestions",
					message:
						"No playlist matches are visible under your current settings.",
				};
			}

			// Build render-ready data for song orientation.
			if (list.orientation === "song" && list.subject.orientation === "song") {
				const fetchResult = await fetchSongOrientationData(supabase, {
					songId,
					suggestions: list.suggestions,
					accountId: session.accountId,
					operation: "get_match_review_item",
				});
				if (fetchResult.status === "missing-song") {
					return {
						status: "unavailable",
						itemId,
						reason: "missing-song",
						message: "This song could not be found.",
					};
				}
				if (fetchResult.status === "playlist-error") {
					return {
						status: "retryable-error",
						itemId,
						message: "Could not load playlist data.",
					};
				}
				return {
					status: "ready",
					itemId,
					mode: "song" as const,
					reviewItem: fetchResult.reviewItem,
					suggestions: fetchResult.suggestions,
				};
			}

			// Playlist mode is not implemented in this server function.
			return {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			};
		} catch (error) {
			// Unexpected DB or runtime failures must not leak internals to the
			// client — but they must still reach us, or a card that silently fails
			// to load looks identical to "no matches" (the bug that started this).
			captureServerError(error, {
				area: "match_review_queue",
				operation: "get_match_review_item",
				accountId: session.accountId,
				extra: { itemId },
			});
			return {
				status: "retryable-error",
				itemId,
				message: "An unexpected error occurred.",
			};
		}
	});

const PresentMatchReviewItemSchema = z.object({
	itemId: z.uuid(),
});

/**
 * Orientation-aware copy for the no-visible-suggestions card. A song-orientation
 * subject is matched against playlists; a playlist-orientation subject against
 * songs — so this must name the suggestion side. The UI renders itemData.message
 * verbatim, so a hard-coded "playlist matches" would mislabel a playlist card
 * whose missing suggestions are actually songs (A1 orientation correctness).
 */
function noVisibleSuggestionsMessage(orientation: MatchOrientation): string {
	return orientation === "playlist"
		? "No song matches are visible under your current settings."
		: "No playlist matches are visible under your current settings.";
}

/**
 * Returns an `unavailable` card for an *owned* queue item whose subject can't be
 * shown (lost entitlement, unverifiable session), stamping an empty visible-pairs
 * capture FIRST so the card is skippable.
 *
 * The unavailable card's Skip action calls finishMatchReviewItem, and the
 * finish/dismiss RPCs guard on visible_pairs_captured_at (NOT the pair row
 * count): a NULL capture is rejected as no_captured_pairs, which leaves the card
 * stuck in the active queue with no way to resolve it. An empty capture stamps
 * the timestamp and activates the item with zero pairs — the same captured-empty
 * state behind a no-visible-suggestions card — so finish resolves it as a clean
 * skip writing no decision/event rows.
 *
 * If the stamping capture itself fails with a db-error we surface retryable
 * rather than an unskippable card, so the user can retry instead of getting stuck.
 */
async function presentUnavailableOwnedItem(
	itemId: string,
	accountId: string,
	orientation: MatchOrientation,
	reason: "not-entitled" | "snapshot-not-owned",
	message: string,
): Promise<MatchReviewItemRead> {
	const capture = await captureVisiblePairsAtomic(itemId, accountId, []);
	if (capture.status === "db-error") {
		// The empty-capture stamp itself hit an operational DB failure — capture it
		// before returning retryable, or a card that can't be made skippable looks
		// the same as a transient blip with no server-side trace.
		reportQueueError(capture.error, "present_unavailable_owned_item", {
			accountId,
			orientation,
		});
		return {
			status: "retryable-error",
			itemId,
			message: "Couldn't load this match card. Try again.", // H7
		};
	}
	return { status: "unavailable", itemId, reason, message };
}

/**
 * Authoritative card presentation: derives the visible suggestion list (MSR-22),
 * atomically captures it (MSR-23), then returns render-ready song and playlist
 * data keyed off captured rows.
 *
 * Side effects: sets queue item active, writes visible pair rows, clears song
 * newness on song-mode presentation (idempotent, best-effort).
 *
 * First-write-wins capture: retries return the stored pair rows without
 * recomputing the visible set. This is the ONLY authoritative presentation
 * path — getMatchReviewItem is side-effect-free prefetch only (D9, D10).
 */
export const presentMatchReviewItem = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => PresentMatchReviewItemSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewItemRead> => {
		const { session } = context;
		const { itemId } = data;

		try {
			// Ownership check: load item by id AND account_id in one query. Foreign
			// or missing items return unavailable without leaking id existence.
			const item = await fetchOwnedQueueItem(
				itemId,
				session.accountId,
				"present_match_review_item",
			);
			if (!item) {
				return {
					status: "unavailable",
					itemId,
					reason: "not-entitled",
					message: "Item not found.",
				};
			}

			// Load session's stored strictness — must not re-read live preferences so
			// the bar matches what was visible when the queue was built.
			const supabase = createAdminSupabaseClient();
			const { data: sessionRow, error: sessionError } = await supabase
				.from("match_review_session")
				.select("strictness_min_score")
				.eq("id", item.sessionId)
				.eq("account_id", session.accountId)
				.maybeSingle();

			if (sessionError || !sessionRow) {
				// `.maybeSingle()` yields a null error for a no-rows/ownership miss, so a
				// truthy sessionError is operational — capture before folding it into the
				// snapshot-not-owned card.
				if (sessionError) {
					reportQueueError(sessionError, "present_match_review_item", {
						accountId: session.accountId,
						orientation: item.subject.orientation,
					});
				}
				return presentUnavailableOwnedItem(
					itemId,
					session.accountId,
					item.subject.orientation,
					"snapshot-not-owned",
					"This item's session could not be verified.",
				);
			}

			const strictnessMinScore = sessionRow.strictness_min_score;

			// Derive the visible suggestion list (MSR-22 authority). This is the
			// only derivation path — capture and downstream paths must not re-derive.
			const listResult = await computeVisibleSuggestionList(
				item,
				strictnessMinScore,
			);

			if (listResult.kind === "not-entitled") {
				const message =
					listResult.reason === "song-not-entitled"
						? "This song is no longer available to match." // H6
						: "This playlist is no longer available to match."; // H6
				return presentUnavailableOwnedItem(
					itemId,
					session.accountId,
					item.subject.orientation,
					"not-entitled",
					message,
				);
			}

			if (listResult.kind === "db-error") {
				// Operational DB failure deriving the suggestion list. Returned Result,
				// so it bypasses the outer catch — capture it here.
				reportQueueError(listResult.error, "present_match_review_item", {
					accountId: session.accountId,
					orientation: item.subject.orientation,
				});
				return {
					status: "retryable-error",
					itemId,
					message: "Couldn't load this match card. Try again.", // H7
				};
			}

			const { list } = listResult;

			// Cap the playlist card's suggestion set to the top N by visibleRank BEFORE
			// capture (P2). Capturing the capped set keeps the visible-pair rows — the
			// authority the finish/dismiss RPCs read — aligned with exactly what the
			// card renders, so a skip/dismiss never writes decisions for a suggestion
			// the user couldn't see. list.suggestions is already visibleRank-ordered, so
			// slicing preserves ranks 1..N. Song mode stays uncapped.
			const suggestionsToCapture =
				list.orientation === "playlist"
					? list.suggestions.slice(0, PLAYLIST_CARD_SUGGESTION_CAP)
					: list.suggestions;

			// Atomically capture the visible pairs (MSR-23 first-write-wins RPC).
			// Retries return the original captured rows so visible ranks are stable.
			const captureResult = await captureVisiblePairsAtomic(
				itemId,
				session.accountId,
				suggestionsToCapture,
			);

			// Determine the active suggestion set from the capture result. On retry
			// the already_captured pairs are authoritative — the fresh derivation
			// above is discarded in favour of the stored rows.
			type SuggestionEntry = {
				songId: string;
				playlistId: string;
				fitScore: number;
				visibleRank: number;
			};
			let activeSuggestions: SuggestionEntry[];

			if (captureResult.status === "captured") {
				// Maps from the capped set actually written this call, not list.suggestions.
				activeSuggestions = suggestionsToCapture.map((s) => ({
					songId: s.songId,
					playlistId: s.playlistId,
					fitScore: s.fitScore,
					visibleRank: s.visibleRank,
				}));
			} else if (captureResult.status === "already_captured") {
				activeSuggestions = captureResult.pairs.map((p) => ({
					songId: p.songId,
					playlistId: p.playlistId,
					fitScore: p.fitScore,
					visibleRank: p.visibleRank,
				}));
			} else if (captureResult.status === "empty") {
				return {
					status: "unavailable",
					itemId,
					reason: "no-visible-suggestions",
					message: noVisibleSuggestionsMessage(item.subject.orientation),
				};
			} else if (captureResult.status === "not_found") {
				return {
					status: "unavailable",
					itemId,
					reason: "not-entitled",
					message: "Item not found.",
				};
			} else if (captureResult.status === "already_resolved") {
				return {
					status: "unavailable",
					itemId,
					reason: "already-resolved",
					message: "This item has already been resolved.",
				};
			} else {
				// invalid_input or db-error — retryable per H7. A db-error is an
				// operational capture failure (invalid_input is a contract bug); both are
				// worth a server-side trace before the opaque retryable card.
				if (captureResult.status === "db-error") {
					reportQueueError(captureResult.error, "present_match_review_item", {
						accountId: session.accountId,
						orientation: item.subject.orientation,
					});
				}
				return {
					status: "retryable-error",
					itemId,
					message: "Couldn't load this match card. Try again.",
				};
			}

			// An already_captured retry with zero stored pairs mirrors the empty
			// outcome — surface as no-visible-suggestions rather than ready with [].
			if (activeSuggestions.length === 0) {
				return {
					status: "unavailable",
					itemId,
					reason: "no-visible-suggestions",
					message: noVisibleSuggestionsMessage(item.subject.orientation),
				};
			}

			// Build render-ready data keyed off the active suggestion set.
			if (list.orientation === "song" && list.subject.orientation === "song") {
				const songId = list.subject.songId;

				// Clear song newness on song-mode presentation — idempotent upsert.
				// Best-effort: a failure must not fail the presentation.
				const now = new Date().toISOString();
				await clearSongNewness(session.accountId, songId, now);

				const fetchResult = await fetchSongOrientationData(supabase, {
					songId,
					suggestions: activeSuggestions,
					accountId: session.accountId,
					operation: "present_match_review_item",
				});
				if (fetchResult.status === "missing-song") {
					return {
						status: "unavailable",
						itemId,
						reason: "missing-song",
						message: "This song could not be found.",
					};
				}
				if (fetchResult.status === "playlist-error") {
					return {
						status: "retryable-error",
						itemId,
						message: "Couldn't load this match card. Try again.",
					};
				}
				return {
					status: "ready",
					itemId,
					mode: "song",
					reviewItem: fetchResult.reviewItem,
					suggestions: fetchResult.suggestions,
				};
			}

			// Playlist arm: review subject is a playlist; suggestions are songs.
			if (
				list.orientation === "playlist" &&
				list.subject.orientation === "playlist"
			) {
				const playlistId = list.subject.playlistId;

				// The suggestion song set for one playlist can reach the 1000-row cap,
				// so the `.in("id", …)` read is chunked to keep each request's query
				// string under the URI-length limit (same 414 bug class as the queue
				// bootstrap). The playlist row read rides alongside it unchanged.
				const [playlistRowResult, songRowsResult] = await Promise.all([
					supabase
						.from("playlist")
						.select("id, name, match_intent, song_count, image_url, spotify_id")
						.eq("id", playlistId)
						.single(),
					chunkedRead(
						activeSuggestions.map((s) => s.songId),
						(batch) =>
							fromSupabaseMany(
								supabase
									.from("song")
									.select(
										"id, name, artists, album_name, image_url, spotify_id, genres",
									)
									.in("id", batch),
							),
					),
				]);

				if (playlistRowResult.error || !playlistRowResult.data) {
					return {
						status: "unavailable",
						itemId,
						reason: "missing-song",
						message: "This playlist could not be found.",
					};
				}

				if (Result.isError(songRowsResult)) {
					// Operational DB failure on the suggestion-song `.in(...)` read.
					reportQueueError(songRowsResult.error, "present_match_review_item", {
						accountId: session.accountId,
						orientation: item.subject.orientation,
					});
					return {
						status: "retryable-error",
						itemId,
						message: "Couldn't load this match card. Try again.",
					};
				}

				const pl = playlistRowResult.data;
				const reviewItem: MatchingPlaylistForReview = {
					id: pl.id,
					spotifyId: pl.spotify_id,
					name: pl.name,
					description: pl.match_intent,
					imageUrl: pl.image_url,
					trackCount: pl.song_count,
				};

				const songMap = new Map(songRowsResult.value.map((s) => [s.id, s]));

				// activeSuggestions arrives ordered by visibleRank from the capture RPC.
				const suggestions: MatchingSongSuggestion[] = [];
				for (const s of activeSuggestions
					.slice()
					.sort((a, b) => a.visibleRank - b.visibleRank)) {
					const songRow = songMap.get(s.songId);
					if (!songRow) continue;
					suggestions.push({
						song: {
							id: songRow.id,
							spotifyId: songRow.spotify_id,
							name: songRow.name,
							artist: songRow.artists[0] ?? "Unknown Artist",
							album: songRow.album_name,
							albumArtUrl: songRow.image_url,
							genres: songRow.genres,
							// Audio features and analysis are not surfaced in the playlist-mode
							// card render; fetching them would add two joins with no UI benefit.
							audioFeatures: null,
							analysis: null,
						},
						// fitScore = strictnessScore from the captured pair — never reranker/ordering (A5, E7).
						fitScore: s.fitScore,
					});
				}

				return {
					status: "ready",
					itemId,
					mode: "playlist",
					reviewItem,
					suggestions,
				};
			}

			// Should not be reachable; guards above cover all orientations.
			return {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			};
		} catch (error) {
			// Unexpected DB or runtime failures must not leak internals to the
			// client — but they must still reach us (see get_match_review_item).
			captureServerError(error, {
				area: "match_review_queue",
				operation: "present_match_review_item",
				accountId: session.accountId,
				extra: { itemId },
			});
			return {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			};
		}
	});

const MarkPresentedSchema = z.object({
	itemId: z.uuid(),
});

/**
 * Marks the queue item as presented — sets state=presented, records
 * presented_at, and clears newness for the song durably.
 */
export const markMatchReviewItemPresented = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => MarkPresentedSchema.parse(data))
	.handler(
		async ({ data, context }): Promise<MatchReviewItemPresentedResult> => {
			const { session } = context;
			const { itemId } = data;

			// Ownership check before any mutation — must confirm the item belongs to
			// this account before writing the presented state.
			const item = await fetchOwnedQueueItem(
				itemId,
				session.accountId,
				"mark_item_presented",
			);
			if (!item) {
				return { success: false, itemId, state: "unknown" };
			}

			// Song-mode only for now; playlist items are not yet presented via this path.
			const songId =
				item.subject.orientation === "song" ? item.subject.songId : null;
			if (!songId) {
				return { success: false, itemId, state: item.state };
			}

			const result = await markItemPresented(itemId, session.accountId, songId);
			if (Result.isError(result)) {
				// Operational DB failure stamping the presented state — not a normal
				// race (that is the null-value branch below). Capture before swallowing.
				reportQueueError(result.error, "mark_item_presented", {
					accountId: session.accountId,
					orientation: item.subject.orientation,
				});
				return { success: false, itemId, state: item.state };
			}

			// null means the conditional update matched no eligible row: the item is
			// already resolved or raced with finish/dismiss. Report failure with the
			// item's current state rather than resurrecting it to "presented".
			if (result.value === null) {
				return { success: false, itemId, state: item.state };
			}

			return { success: true, itemId, state: result.value.state };
		},
	);

// ============================================================================
// Queue-aware mutations (Phase 4)
// ============================================================================

// No RESOLVED_STATES set needed — the B9-C lifecycle split means `state === 'resolved'`
// is the single terminal check for both add and dismiss guards.

const AddFromQueueSchema = z.object({
	itemId: z.uuid(),
	suggestionId: z.uuid(),
});

export interface AddFromQueueResult {
	success: boolean;
	/** Populated when success is false, to distinguish errors from rejections. */
	reason?:
		| "not-found"
		| "already-resolved"
		| "not-entitled"
		| "foreign-playlist"
		| "not-visible"
		| "invalid-target";
}

/**
 * Adds a suggestion to a queue item and writes a decision linked to the item.
 * Does NOT advance/resolve the card — the user may add multiple suggestions
 * before finishing.
 *
 * Orientation-aware: for song-orientation items, suggestionId is a playlist id;
 * for playlist-orientation items, suggestionId is a song id. The RPC derives
 * the subject side from the locked queue item row (never from client input) and
 * validates the suggestion against the captured visible pair rows written by
 * presentMatchReviewItem (MSR-23 capture). Ranks come from the captured pair.
 */
export const addSongToPlaylistFromQueueItem = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AddFromQueueSchema.parse(data))
	.handler(async ({ data, context }): Promise<AddFromQueueResult> => {
		const { session } = context;
		const { itemId, suggestionId } = data;

		const item = await fetchOwnedQueueItem(
			itemId,
			session.accountId,
			"add_queue_item_decision",
		);
		if (!item) {
			return { success: false, reason: "not-found" };
		}

		if (item.state === "resolved") {
			return { success: false, reason: "already-resolved" };
		}

		// Determine the orientation-aware argument layout for the RPC. The RPC
		// locks the item row and derives the subject side itself — we only supply
		// the suggestion side. The RPC returns invalid_target when the wrong column
		// is non-null for the item's orientation, so both arms are safe.
		const isSongOrientation = item.subject.orientation === "song";
		const result = await addQueueItemDecisionAtomically(
			itemId,
			session.accountId,
			isSongOrientation ? null : suggestionId,
			isSongOrientation ? suggestionId : null,
		);
		if (Result.isError(result)) {
			// Atomic add-decision write failed at the DB — capture before returning
			// the opaque failure so a stuck "Add" is diagnosable server-side.
			reportQueueError(result.error, "add_queue_item_decision", {
				accountId: session.accountId,
				orientation: item.subject.orientation,
			});
			return { success: false };
		}

		if (result.value === "added") return { success: true };
		if (result.value === "not_found") {
			return { success: false, reason: "not-found" };
		}
		if (result.value === "already_resolved") {
			return { success: false, reason: "already-resolved" };
		}
		if (result.value === "not_entitled") {
			return { success: false, reason: "not-entitled" };
		}
		if (result.value === "not_visible") {
			return { success: false, reason: "not-visible" };
		}
		if (result.value === "invalid_target") {
			return { success: false, reason: "invalid-target" };
		}
		return { success: false, reason: "foreign-playlist" };
	});

const DismissQueueSchema = z.object({
	itemId: z.uuid(),
});

export interface DismissQueueResult {
	success: boolean;
	reason?:
		| "not-found"
		| "already-resolved"
		| "derive-failed"
		| "decision-write-failed";
}

/**
 * Dismisses a queue item using captured visible pairs as the decision authority
 * (MSR-27). The RPC reads match_review_item_visible_pair rows written by
 * presentMatchReviewItem, so ranks are never recomputed at dismiss time and the
 * dismissed set is always exactly what the user saw on screen.
 *
 * Pair ownership and orientation are resolved server-side inside the RPC — no
 * playlist ids are accepted from the client.
 */
export const dismissMatchReviewItem = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => DismissQueueSchema.parse(data))
	.handler(async ({ data, context }): Promise<DismissQueueResult> => {
		const { session } = context;
		const { itemId } = data;

		const item = await fetchOwnedQueueItem(
			itemId,
			session.accountId,
			"dismiss_queue_item",
		);
		if (!item) {
			return { success: false, reason: "not-found" };
		}

		if (item.state === "resolved") {
			return { success: false, reason: "already-resolved" };
		}

		const dismissResult = await dismissQueueItemAtomically(
			itemId,
			session.accountId,
		);
		if (Result.isError(dismissResult)) {
			// Atomic dismiss write failed at the DB — capture before returning the
			// opaque decision-write-failed so the failure is diagnosable server-side.
			reportQueueError(dismissResult.error, "dismiss_queue_item", {
				accountId: session.accountId,
				orientation: item.subject.orientation,
			});
			return { success: false, reason: "decision-write-failed" };
		}

		if (dismissResult.value === "not_found") {
			return { success: false, reason: "not-found" };
		}
		if (dismissResult.value === "already_resolved") {
			return { success: false, reason: "already-resolved" };
		}
		// no_captured_pairs means presentMatchReviewItem has not yet run — the item
		// should not be resolved so the dismiss can be retried after presentation.
		if (dismissResult.value === "no_captured_pairs") {
			return { success: false, reason: "derive-failed" };
		}

		return { success: true };
	});

const FinishQueueSchema = z.object({
	itemId: z.uuid(),
});

export interface FinishQueueResult {
	success: boolean;
	resolution?: "added" | "skipped";
	reason?:
		| "not-found"
		| "already-resolved"
		| "derive-failed"
		| "decision-count-failed";
}

/**
 * Finishes a queue card (the "Next Song" / "Finish matching" action).
 *
 * Delegates to an atomic RPC that locks the queue item, counts add decisions
 * linked to this queue_item_id, writes skip events for non-added captured
 * pairs, then resolves the item. Add takes the same lock before writing, so
 * finish cannot miss an in-flight add.
 *
 * - ≥1 add found → resolved/added; skip events written for non-added pairs
 * - 0 adds found → resolved/skipped; skip events written for all captured pairs
 * - no captured pairs → derive-failed (presentMatchReviewItem must run first)
 */
export const finishMatchReviewItem = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => FinishQueueSchema.parse(data))
	.handler(async ({ data, context }): Promise<FinishQueueResult> => {
		const { session } = context;
		const { itemId } = data;

		// The RPC locks the queue row before counting linked add decisions. Because
		// add also takes the same lock before writing, finish cannot resolve as
		// skipped while an add decision is in flight.
		const result = await finishQueueItemAtomically(itemId, session.accountId);
		if (Result.isError(result)) {
			// Atomic finish/count failed at the DB. This path never loads the queue
			// item, so orientation is unknown — capture with the itemId instead.
			captureServerError(result.error, {
				area: "match_review_queue",
				operation: "finish_queue_item",
				accountId: session.accountId,
				extra: { itemId },
			});
			return { success: false, reason: "decision-count-failed" };
		}

		if (result.value === "not_found") {
			return { success: false, reason: "not-found" };
		}
		if (result.value === "already_resolved") {
			return { success: false, reason: "already-resolved" };
		}
		// no_captured_pairs means presentMatchReviewItem has not yet run — the item
		// should not be resolved so finish can be retried after presentation.
		if (result.value === "no_captured_pairs") {
			return { success: false, reason: "derive-failed" };
		}
		if (result.value === "completed_added") {
			return { success: true, resolution: "added" };
		}
		return { success: true, resolution: "skipped" };
	});

// ============================================================================
// Queue summary (Phase 7 — dashboard CTA, sidebar badge, empty-state)
// ============================================================================

export interface ServerMatchReviewSummaryResult {
	pendingCount: number;
	previewImages: Array<{
		id: number;
		image: string;
		name: string;
		artist: string;
	}>;
	hasActiveQueue: boolean;
	/** Which orientation this summary reflects — used by the sidebar/dashboard to
	 *  build the correct Match link (/match vs /match?mode=playlist). */
	orientation: MatchOrientation;
}

/**
 * Resolves the queue-aware match review summary for a specific orientation.
 *
 * Active-queue path: asks the domain for the pending count and top-3 subject ids
 * (songs in song mode, playlists in playlist mode), then maps them → preview rows.
 *
 * Snapshot-fallback path (no active queue): derives count and preview ids from
 * the latest snapshot using the orientation's ordering authority
 * (getOrderedUndecidedSongIds / getOrderedUndecidedPlaylistIds) — the same
 * derivation the /match walk uses — without creating a queue. Queue creation
 * happens only on /match entry via startOrResumeMatchReview.
 *
 * Exported so dashboard.functions.ts can call it once and share the result
 * across both the CTA count and the preview fan.
 */
export async function resolveMatchReviewSummary(
	accountId: string,
	orientation: MatchOrientation,
): Promise<ServerMatchReviewSummaryResult> {
	const summaryResult = await getQueueSummary(accountId, orientation);

	if (Result.isError(summaryResult)) {
		// The dashboard still degrades to the snapshot-fallback path below, but a DB
		// failure here is operational (Result.ok carries the no-active-queue case),
		// so capture it — otherwise a persistently blank summary looks like "caught
		// up" with no server-side trace.
		reportQueueError(summaryResult.error, "resolve_match_review_summary", {
			accountId,
			orientation,
		});
	}

	const empty: ServerMatchReviewSummaryResult = {
		pendingCount: 0,
		previewImages: [],
		hasActiveQueue: false,
		orientation,
	};

	let topIds: string[];
	let pendingCount: number;
	let hasActiveQueue: boolean;

	if (Result.isOk(summaryResult) && summaryResult.value.hasActiveQueue) {
		const summary = summaryResult.value;
		pendingCount = summary.pendingCount;
		hasActiveQueue = true;
		topIds = summary.previewSubjectIds.slice(0, 3);
	} else {
		// No active queue — fall back to the latest-snapshot ordering authority so
		// the dashboard previews stay identical to the pre-queue behaviour. We do
		// NOT create a queue here; that is deferred to /match entry.
		hasActiveQueue = false;
		const snapshotResult = await getLatestMatchSnapshot(accountId);
		if (Result.isError(snapshotResult)) {
			// DB failure reading the latest snapshot — capture before degrading to
			// empty (a null value is the normal "no snapshot yet" case, not captured).
			reportQueueError(snapshotResult.error, "resolve_match_review_summary", {
				accountId,
				orientation,
			});
			return empty;
		}
		if (!snapshotResult.value) return empty;

		if (orientation === "playlist") {
			const playlistIdsResult = await getOrderedUndecidedPlaylistIds(
				snapshotResult.value.id,
				accountId,
			);
			// A transient failure surfaces as an empty summary rather than crashing
			// the dashboard; the next refetch recovers — but capture it so the blank
			// is diagnosable.
			if (Result.isError(playlistIdsResult)) {
				reportQueueError(
					playlistIdsResult.error,
					"resolve_match_review_summary",
					{ accountId, orientation },
				);
				return empty;
			}
			pendingCount = playlistIdsResult.value.playlistIds.length;
			topIds = playlistIdsResult.value.playlistIds.slice(0, 3);
		} else {
			const songIdsResult = await getOrderedUndecidedSongIds(
				snapshotResult.value.id,
				accountId,
			);
			// A transient failure surfaces as an empty summary rather than crashing
			// the dashboard; the next refetch recovers — but capture it so the blank
			// is diagnosable.
			if (Result.isError(songIdsResult)) {
				reportQueueError(songIdsResult.error, "resolve_match_review_summary", {
					accountId,
					orientation,
				});
				return empty;
			}
			pendingCount = songIdsResult.value.songIds.length;
			topIds = songIdsResult.value.songIds.slice(0, 3);
		}
	}

	if (topIds.length === 0) {
		return { pendingCount, previewImages: [], hasActiveQueue, orientation };
	}

	const previewImages =
		orientation === "playlist"
			? await resolvePlaylistPreviews(topIds)
			: await resolveSongPreviews(topIds);

	return { pendingCount, previewImages, hasActiveQueue, orientation };
}

/**
 * Maps song subject IDs to preview entries (image + name + artist), preserving
 * the input order. Songs without an image are dropped so the fan never shows a
 * broken tile.
 */
async function resolveSongPreviews(
	topIds: string[],
): Promise<ServerMatchReviewSummaryResult["previewImages"]> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("song")
		.select("id, image_url, name, artists")
		.in("id", topIds);

	if (error || !data) return [];

	const songMap = new Map(data.map((s) => [s.id, s]));
	return topIds
		.map((id, i) => {
			const song = songMap.get(id);
			return song?.image_url
				? {
						id: i + 1,
						image: song.image_url,
						name: song.name,
						artist: song.artists[0] ?? "Unknown Artist",
					}
				: null;
		})
		.filter(
			(p): p is ServerMatchReviewSummaryResult["previewImages"][number] =>
				p !== null,
		);
}

/**
 * Playlist counterpart to resolveSongPreviews: maps playlist subject IDs to
 * preview entries. Playlists have no artist, so that field is empty (the dashboard
 * preview tile renders name + image only). Playlists without an image are dropped.
 */
async function resolvePlaylistPreviews(
	topIds: string[],
): Promise<ServerMatchReviewSummaryResult["previewImages"]> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("playlist")
		.select("id, image_url, name")
		.in("id", topIds);

	if (error || !data) return [];

	const playlistMap = new Map(data.map((p) => [p.id, p]));
	return topIds
		.map((id, i) => {
			const playlist = playlistMap.get(id);
			return playlist?.image_url
				? {
						id: i + 1,
						image: playlist.image_url,
						name: playlist.name,
						artist: "",
					}
				: null;
		})
		.filter(
			(p): p is ServerMatchReviewSummaryResult["previewImages"][number] =>
				p !== null,
		);
}

const GetMatchReviewSummarySchema = z.object({
	orientation: MatchOrientationSchema,
});

/**
 * Returns the queue-aware match review summary.
 * Backs the sidebar badge and is available for targeted refetch.
 * Dashboard uses resolveMatchReviewSummary directly (no extra HTTP round-trip).
 */
export const getMatchReviewSummary = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetMatchReviewSummarySchema.parse(data))
	.handler(
		async ({ data, context }): Promise<ServerMatchReviewSummaryResult> => {
			return resolveMatchReviewSummary(
				context.session.accountId,
				data.orientation,
			);
		},
	);

/**
 * Reads the account's stored match_view_mode preference and delegates to
 * resolveMatchReviewSummary with that orientation. Falls back to 'song' when the
 * preference row is missing or unreadable. Used by dashboard + sidebar so those
 * surfaces always reflect the user's last-selected mode without needing the mode
 * passed explicitly from the client.
 */
export async function resolvePreferredMatchReviewSummary(
	accountId: string,
): Promise<ServerMatchReviewSummaryResult> {
	const mode = await getPreferredMatchViewMode(accountId);
	return resolveMatchReviewSummary(accountId, mode);
}

/**
 * Server function version of resolvePreferredMatchReviewSummary.
 * Backs preferredSummary query key — invalidated after a preference update.
 */
export const getPreferredMatchReviewSummary = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<ServerMatchReviewSummaryResult> => {
		return resolvePreferredMatchReviewSummary(context.session.accountId);
	});

export interface SyncActiveMatchReviewSessionsResult {
	results: Array<{ orientation: MatchOrientation; appendedCount: number }>;
}

// All orientations that can have active sessions. Both are synced in each
// background-refresh cycle so no newly-appended items are missed by the queue.
const ALL_ORIENTATIONS: readonly MatchOrientation[] = ["song", "playlist"];

/**
 * Appends the latest snapshot's eligible subjects to all active review queues.
 * Replaces the singular syncActiveMatchReviewSession: syncs every orientation
 * in one call so a single server round-trip handles both song and playlist
 * sessions after a background match snapshot refresh completes.
 *
 * Idempotent: the domain layer guards against re-applying the same snapshot
 * via the (session_id, snapshot_id, visibility_config_hash) composite key.
 * Returns appendedCount: 0 for any orientation without an active session.
 */
export const syncActiveMatchReviewSessions = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(
		async ({ context }): Promise<SyncActiveMatchReviewSessionsResult> => {
			const { session } = context;

			// Sync both orientations concurrently (P3): each syncActiveQueue call
			// operates on its own orientation's session (independent rows + unique
			// index), so there's no ordering dependency — the old serial for...of just
			// added latency. Promise.all preserves ALL_ORIENTATIONS order in the result.
			const results = await Promise.all(
				ALL_ORIENTATIONS.map(async (orientation) => {
					const result = await syncActiveQueue(session.accountId, orientation, {
						onVisibleAppend: emitQueueAppendEvents,
					});
					return {
						orientation,
						appendedCount: Result.isOk(result) ? result.value.appendedCount : 0,
					};
				}),
			);

			return { results };
		},
	);
