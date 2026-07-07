/**
 * Worker-side capture_ahead (plan §7). Runs the standard materialize flow —
 * derive the visible suggestion list, cap it, capture it first-write-wins — for
 * the next window of unresolved cards, OFF the request path. This is the same
 * capture the request path used to do inline in presentMatchReviewItem, moved
 * ahead of the swiper so a card read is a pure join over captured pairs.
 *
 * Idempotent: captureVisiblePairsAtomic is first-write-wins, so a re-run (sweep
 * resurrection, retry) returns the original ranks and captures nothing new. A
 * decision made mid-flight is re-excluded on the next derive.
 *
 * Reads existing tables via the generated-type admin client + existing RPCs — no
 * escape hatch needed here (the deck-job row identifying the work is resolved by
 * the poller).
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";
import { captureVisiblePairsAtomic } from "./capture-visible-pairs";
import {
	PLAYLIST_CARD_SUGGESTION_CAP,
	SONG_CARD_SUGGESTION_CAP,
} from "./card-suggestion-caps";
import { mapItemToDto } from "./queries";
import type { MatchOrientation } from "./types";
import { computeVisibleSuggestionList } from "./visible-suggestion-list";

/** How many cards ahead of the resume pointer capture_ahead materializes per
 *  run. Small: capture runs after every whole-card action, so the window only
 *  needs to keep a fast swiper from outrunning capture. */
export const CAPTURE_AHEAD_WINDOW = 5;

// The DTO column set mapItemToDto consumes (mirrors fetchQueueItems).
const QUEUE_ITEM_DTO_COLUMNS =
	"id, session_id, account_id, orientation, song_id, playlist_id, source_snapshot_id, position, state, resolution, source_fit_score, was_new_at_enqueue, presented_at, resolved_at, visible_pairs_captured_at, created_at, updated_at";

/**
 * Reads a session's authoritative resume pointer. NULL means "not yet
 * positioned by a promotion/resume"; the caller folds that to position 0.
 */
export async function readSessionResumePosition(
	sessionId: string,
): Promise<Result<number | null, DbError>> {
	const { data, error } = await createAdminSupabaseClient()
		.from("match_review_session")
		.select("resume_position")
		.eq("id", sessionId)
		.maybeSingle();
	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(data?.resume_position ?? null);
}

/**
 * Captures visible pairs for up to `window` unresolved cards at or after
 * `fromPosition` in the session. Best-effort per card: a subject whose entity
 * was revoked (not-entitled) is captured as captured-empty (zero pairs) rather
 * than skipped, so the card still resolves to unavailable instead of getting
 * stuck (H4); an already-resolved item is a no-op via the atomic capture RPC. A
 * DB failure on any card surfaces as an error so the job defers and retries
 * (already-captured cards are no-ops on the retry).
 */
export async function captureAheadForSession(input: {
	accountId: string;
	sessionId: string;
	orientation: MatchOrientation;
	fromPosition: number;
	window: number;
}): Promise<Result<void, DbError>> {
	const { accountId, sessionId, fromPosition, window } = input;
	const supabase = createAdminSupabaseClient();

	const sessionResult = await supabase
		.from("match_review_session")
		.select("strictness_min_score")
		.eq("id", sessionId)
		.eq("account_id", accountId)
		.maybeSingle();
	if (sessionResult.error) {
		return Result.err(
			new DatabaseError({
				code: sessionResult.error.code,
				message: sessionResult.error.message,
			}),
		);
	}
	// Session gone / not this account's — nothing to capture, not an error.
	if (!sessionResult.data) return Result.ok(undefined);
	const strictnessMinScore = sessionResult.data.strictness_min_score;

	const itemsResult = await fromSupabaseMany(
		supabase
			.from("match_review_queue_item")
			.select(QUEUE_ITEM_DTO_COLUMNS)
			.eq("session_id", sessionId)
			.eq("account_id", accountId)
			.in("state", ["pending", "active"])
			.gte("position", fromPosition)
			.order("position", { ascending: true })
			.limit(window),
	);
	if (Result.isError(itemsResult)) return itemsResult;

	let firstError: DbError | null = null;

	for (const row of itemsResult.value) {
		const item = mapItemToDto(row);
		const listResult = await computeVisibleSuggestionList(
			item,
			strictnessMinScore,
		);
		if (listResult.kind === "db-error") {
			firstError ??= listResult.error;
			continue;
		}
		// Entity revoked since enqueue — no pairs to derive, but the item still
		// needs visible_pairs_captured_at stamped (with zero pairs), the same
		// captured-empty shape buildSeedForSubject's promotion path produces for a
		// not-entitled subject. Without this stamp the read RPC keeps returning
		// not_captured forever (visible_pairs_captured_at stays NULL), the R-E
		// on-demand materialize re-derives the same not-entitled result and skips
		// again, and the card is stuck: unreadable, unfinishable, undismissable
		// (H4). Stamping captured-empty makes the read return
		// no_visible_suggestions/unavailable instead, which the existing
		// resolve-empty-card flow already handles.
		const suggestionsToCapture =
			listResult.kind === "not-entitled"
				? []
				: listResult.list.suggestions.slice(
						0,
						item.subject.orientation === "song"
							? SONG_CARD_SUGGESTION_CAP
							: PLAYLIST_CARD_SUGGESTION_CAP,
					);

		const captureResult = await captureVisiblePairsAtomic(
			item.id,
			accountId,
			suggestionsToCapture,
		);
		if (captureResult.status === "db-error") {
			firstError ??= captureResult.error;
		}
		// captured / already_captured / empty / not_found / already_resolved /
		// invalid_input all need no follow-up here.
	}

	if (firstError) return Result.err(firstError);
	return Result.ok(undefined);
}
