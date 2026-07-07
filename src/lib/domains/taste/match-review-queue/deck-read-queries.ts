/**
 * DB layer for the two deck READ RPCs — thin Result wrappers over
 * start_or_resume_match_deck (plan §8) and read_match_deck_card (plan §7).
 * Mirrors callResumeMatchReviewSession / callPresentMatchReviewItemFast in
 * ./queries: fire the RPC, translate a PostgREST error to a DbError, and hand
 * back the raw JSONB payload narrowed to the exported result shape. All mapping
 * to the public MatchDeckView / MatchReviewItemRead contract happens one layer
 * up in the server-fn file.
 *
 * Both RPCs return JSONB (typed Json), so — like the existing resume/fast
 * wrappers — the payload is narrowed with an `as unknown as` cast; the SQL
 * functions' status unions guarantee the shape.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { captureServerError } from "@/lib/observability/capture-server-error";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import type { MatchOrientation } from "./types";

/** Playlist-arm suggestion row (a song) — byte-identical to the present-fast RPC. */
export interface DeckCardSongSuggestionRow {
	song_id: string;
	name: string;
	artists: string[];
	album_name: string | null;
	image_url: string | null;
	spotify_id: string;
	genres: string[];
	fit_score: number;
	visible_rank: number;
	model_rank: number;
}

/** Song-arm suggestion row (a playlist) — the mirror of the playlist arm. */
export interface DeckCardPlaylistSuggestionRow {
	playlist_id: string;
	name: string;
	match_intent: string | null;
	image_url: string | null;
	spotify_id: string;
	song_count: number;
	fit_score: number;
	visible_rank: number;
	model_rank: number;
}

/**
 * Raw payload returned by read_match_deck_card (both orientations). The playlist
 * arm carries `playlist` + song suggestion rows; the song arm carries `song`
 * (with the folded-in audio feature + latest analysis) + playlist suggestion
 * rows. `analysis` is left as `unknown` here and narrowed by the song-card
 * mapper to MatchingSong["analysis"].
 */
export interface ReadMatchDeckCardRpcResult {
	status:
		| "ready"
		| "not_captured"
		| "not_found"
		| "playlist_gone"
		| "song_gone"
		| "no_visible_suggestions";
	item?: {
		id: string;
		session_id?: string;
		orientation?: string;
		playlist_id?: string;
		song_id?: string;
		state: string;
		visible_pairs_captured_at?: string | null;
	};
	playlist?: {
		id: string;
		spotify_id: string;
		name: string;
		match_intent: string | null;
		image_url: string | null;
		song_count: number;
	};
	song?: {
		id: string;
		spotify_id: string;
		name: string;
		artists: string[];
		album_name: string | null;
		image_url: string | null;
		genres: string[];
		audio_feature: {
			tempo: number | null;
			energy: number | null;
			valence: number | null;
		} | null;
		analysis: unknown;
	};
	suggestions?: Array<
		DeckCardSongSuggestionRow | DeckCardPlaylistSuggestionRow
	>;
	total_active_count?: number;
}

/** One card envelope inside a MatchDeckView (the RPC bakes current + next). */
export interface DeckCardEnvelope {
	itemId: string;
	position: number;
	presentation: ReadMatchDeckCardRpcResult;
}

/**
 * Raw payload returned by start_or_resume_match_deck. `status: "active"` carries
 * the full deck view; `status: "miss"` reports no active session + no ready
 * proposal (the TS layer distinguishes "no snapshot" via getLatestMatchSnapshot).
 * `snapshotId` is typed `string | null`: a legacy active session with no active
 * proposal and no ledger row can return null (Phase 1b carry-forward; the mapper
 * coerces per R-F).
 */
export interface StartOrResumeMatchDeckRpcResult {
	status: "active" | "miss";
	reason?: string;
	version?: number;
	accountId?: string;
	orientation?: string;
	sessionId?: string;
	snapshotId?: string | null;
	visibilityConfigHash?: string;
	revision?: number;
	progress?: {
		total: number;
		remaining: number;
		caughtUp: boolean;
		hiddenReviewItemCount: number;
	};
	itemIds?: string[];
	cards?: {
		current: DeckCardEnvelope | null;
		next: DeckCardEnvelope | null;
	};
}

function rpcError(error: { code?: string; message: string }): DbError {
	return new DatabaseError({
		code: error.code ?? "rpc_error",
		message: error.message,
	});
}

/**
 * P1.5: minimal runtime allowlist on the `status` discriminator only — not a
 * full zod schema for the payload — mirroring the allowlist-validation
 * precedent in ./queries.ts (`isDismissQueueItemAtomicStatus` and friends).
 * That precedent turns an unknown status into a `Result.err`; these two RPCs
 * deliberately do NOT — the read-side mappers (match-deck.functions.ts) have
 * dedicated fallback arms for an unexpected status (retryable-error) and their
 * own P1.1 capture, so the value is still returned. This capture is what makes
 * the drift visible at the RPC boundary instead of silently flowing through.
 */
const START_OR_RESUME_MATCH_DECK_STATUSES = ["active", "miss"] as const;
type StartOrResumeMatchDeckStatus =
	(typeof START_OR_RESUME_MATCH_DECK_STATUSES)[number];
function isStartOrResumeMatchDeckStatus(
	value: unknown,
): value is StartOrResumeMatchDeckStatus {
	return START_OR_RESUME_MATCH_DECK_STATUSES.some((status) => status === value);
}

const READ_MATCH_DECK_CARD_STATUSES = [
	"ready",
	"not_captured",
	"not_found",
	"playlist_gone",
	"song_gone",
	"no_visible_suggestions",
] as const;
type ReadMatchDeckCardStatus = (typeof READ_MATCH_DECK_CARD_STATUSES)[number];
function isReadMatchDeckCardStatus(
	value: unknown,
): value is ReadMatchDeckCardStatus {
	return READ_MATCH_DECK_CARD_STATUSES.some((status) => status === value);
}

/**
 * Calls start_or_resume_match_deck (plan §8) — one bounded round trip for
 * /match entry. `visibilityConfigHash` is computed in TS (as resume does today)
 * so a ready proposal for the exact policy is found; `window` bounds the current
 * and next card suggestion lists.
 *
 * `visibilityConfigHash` accepts `null` for the M10 skip-hash-computation probe:
 * branch 1 (active session) never reads p_visibility_config_hash, so a null
 * probe is safe there; branch 2's exact-match filter never matches a null hash,
 * so a null probe is guaranteed to report `status: "miss"` when there is no
 * active session, correctly forcing the caller to fall back to computing the
 * real hash.
 */
export async function callStartOrResumeMatchDeck(
	accountId: string,
	orientation: MatchOrientation,
	visibilityConfigHash: string | null,
	window?: number,
): Promise<Result<StartOrResumeMatchDeckRpcResult, DbError>> {
	const { data, error } = await createAdminSupabaseClient().rpc(
		"start_or_resume_match_deck",
		{
			p_account_id: accountId,
			p_orientation: orientation,
			// The generated Args type has no way to express "TEXT, nullable at the SQL
			// level" (codegen types every function TEXT param as non-null `string`),
			// but the RPC itself is happy to receive NULL here — cast to bridge that
			// gap rather than widen the generated type.
			p_visibility_config_hash: visibilityConfigHash as string,
			p_window: window ?? undefined,
		},
	);
	if (error) return Result.err(rpcError(error));
	const result = data as unknown as StartOrResumeMatchDeckRpcResult;
	if (!isStartOrResumeMatchDeckStatus(result.status)) {
		captureServerError(
			new Error(
				`start_or_resume_match_deck returned an unknown status: ${result.status}`,
			),
			{
				area: "match_review_queue",
				operation: "call_start_or_resume_match_deck",
				accountId,
				extra: { orientation, status: result.status },
			},
		);
	}
	return Result.ok(result);
}

/**
 * Calls read_match_deck_card (plan §7) — a pure join over captured pairs for one
 * card, dismissed pairs excluded in SQL, first `limit` rows + post-dismissal
 * total. `markPresented` stamps presented_at (only the CURRENT card is marked).
 */
export async function callReadMatchDeckCard(
	itemId: string,
	accountId: string,
	limit?: number,
	markPresented = true,
): Promise<Result<ReadMatchDeckCardRpcResult, DbError>> {
	const { data, error } = await createAdminSupabaseClient().rpc(
		"read_match_deck_card",
		{
			p_item_id: itemId,
			p_account_id: accountId,
			p_limit: limit ?? undefined,
			p_mark_presented: markPresented,
		},
	);
	if (error) return Result.err(rpcError(error));
	const result = data as unknown as ReadMatchDeckCardRpcResult;
	if (!isReadMatchDeckCardStatus(result.status)) {
		captureServerError(
			new Error(
				`read_match_deck_card returned an unknown status: ${result.status}`,
			),
			{
				area: "match_review_queue",
				operation: "call_read_match_deck_card",
				accountId,
				extra: { itemId, status: result.status },
			},
		);
	}
	return Result.ok(result);
}
