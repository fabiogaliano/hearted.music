/**
 * DB layer for the two deck READ RPCs — thin Result wrappers over
 * start_or_resume_match_deck (plan §8) and read_match_deck_card (plan §7). Each
 * fires the RPC and decodes the JSONB payload through the schema below, which
 * owns its shape. Mapping to the public MatchDeckView / MatchReviewItemRead
 * contract happens one layer up.
 *
 * Both schemas end in a catch-all arm: an unknown status (or a known status
 * whose payload drifted) decodes to `{ status, unrecognized: true }` instead of
 * failing the read. The mappers render that as a retryable card / a miss, and
 * the captures below and at the mapper call sites make the drift visible.
 */

import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { captureServerError } from "@/lib/observability/capture-server-error";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseRpc } from "@/lib/shared/utils/result-wrappers/supabase";
import type { MatchOrientation } from "./types";

// Row and subject schemas validate only the fields the mappers read, so an RPC
// column addition doesn't need a schema update here.

/** Playlist-arm suggestion row (a song) — byte-identical to the present-fast RPC. */
const DeckCardSongSuggestionRowSchema = z.looseObject({
	song_id: z.string(),
	name: z.string(),
	artists: z.array(z.string()),
	album_name: z.string().nullable(),
	image_url: z.string().nullable(),
	spotify_id: z.string(),
	genres: z.array(z.string()),
	fit_score: z.number(),
	model_rank: z.number(),
});

/** Song-arm suggestion row (a playlist) — the mirror of the playlist arm. */
const DeckCardPlaylistSuggestionRowSchema = z.looseObject({
	playlist_id: z.string(),
	name: z.string(),
	match_intent: z.string().nullable(),
	image_url: z.string().nullable(),
	spotify_id: z.string(),
	song_count: z.number().nullable(),
	fit_score: z.number(),
	visible_rank: z.number(),
});

const DeckCardPlaylistSchema = z.looseObject({
	id: z.string(),
	spotify_id: z.string(),
	name: z.string(),
	match_intent: z.string().nullable(),
	image_url: z.string().nullable(),
	song_count: z.number().nullable(),
});

const DeckCardSongSchema = z.looseObject({
	id: z.string(),
	spotify_id: z.string(),
	name: z.string(),
	artists: z.array(z.string()),
	album_name: z.string().nullable(),
	image_url: z.string().nullable(),
	genres: z.array(z.string()),
	audio_feature: z
		.object({
			tempo: z.number().nullable(),
			energy: z.number().nullable(),
			valence: z.number().nullable(),
		})
		.nullable(),
	// Versioned song_analysis jsonb, passed through to the card as stored.
	analysis: z.unknown(),
});

/** Statuses that carry no payload the mappers read. */
const BareCardStatusSchema = z.enum([
	"not_captured",
	"not_found",
	"playlist_gone",
	"song_gone",
	"no_visible_suggestions",
]);

const KNOWN_CARD_STATUSES: ReadonlySet<string> = new Set([
	"ready",
	...BareCardStatusSchema.options,
]);

/** Both orientations' `ready` arms share the status, so this is a plain union. */
const KnownCardSchema = z.union([
	z.object({
		status: z.literal("ready"),
		playlist: DeckCardPlaylistSchema,
		suggestions: z.array(DeckCardSongSuggestionRowSchema),
		total_active_count: z.number(),
	}),
	z.object({
		status: z.literal("ready"),
		song: DeckCardSongSchema,
		suggestions: z.array(DeckCardPlaylistSuggestionRowSchema),
		total_active_count: z.number(),
	}),
	z.object({ status: BareCardStatusSchema }),
]);

function catchAll() {
	return z
		.looseObject({ status: z.string() })
		.transform((raw) => ({ ...raw, unrecognized: true as const }));
}

/** Payload returned by read_match_deck_card (both orientations). */
export const ReadMatchDeckCardResultSchema = z.union([
	KnownCardSchema,
	catchAll(),
]);
export type ReadMatchDeckCardRpcResult = z.infer<
	typeof ReadMatchDeckCardResultSchema
>;

const DeckCardEnvelopeSchema = z.object({
	itemId: z.string(),
	position: z.number(),
	presentation: ReadMatchDeckCardResultSchema,
});
/** One card envelope inside a MatchDeckView (the RPC bakes current + next). */
export type DeckCardEnvelope = z.infer<typeof DeckCardEnvelopeSchema>;

const ActiveMatchDeckSchema = z.object({
	status: z.literal("active"),
	version: z.literal(1),
	accountId: z.string(),
	orientation: z.string(),
	sessionId: z.string(),
	// A legacy active session with no active proposal and no ledger row has no
	// snapshot (Phase 1b carry-forward; the view mapper coerces per R-F).
	snapshotId: z.string().nullable(),
	// Null when a legacy session (no active proposal) is probed with a null hash:
	// the RPC echoes the caller's hash back.
	visibilityConfigHash: z.string().nullish(),
	revision: z.number(),
	progress: z.object({
		total: z.number(),
		remaining: z.number(),
		caughtUp: z.boolean(),
		hiddenReviewItemCount: z.number(),
	}),
	itemIds: z.array(z.string()),
	cards: z.object({
		current: DeckCardEnvelopeSchema.nullable(),
		next: DeckCardEnvelopeSchema.nullable(),
	}),
});
export type ActiveMatchDeckRpcResult = z.infer<typeof ActiveMatchDeckSchema>;

/**
 * Payload returned by start_or_resume_match_deck. `miss` reports no active
 * session + no ready proposal (the TS layer distinguishes "no snapshot" via
 * getLatestMatchSnapshot).
 */
export const StartOrResumeMatchDeckResultSchema = z.union([
	z.discriminatedUnion("status", [
		ActiveMatchDeckSchema,
		z.object({ status: z.literal("miss"), reason: z.string() }),
	]),
	catchAll(),
]);
export type StartOrResumeMatchDeckRpcResult = z.infer<
	typeof StartOrResumeMatchDeckResultSchema
>;

/** The active deck, or null for a miss or an unrecognized payload. */
export function activeDeckOrNull(
	rpc: StartOrResumeMatchDeckRpcResult,
): ActiveMatchDeckRpcResult | null {
	if ("unrecognized" in rpc || rpc.status !== "active") return null;
	return rpc;
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
	const result = await fromSupabaseRpc(
		StartOrResumeMatchDeckResultSchema,
		createAdminSupabaseClient().rpc("start_or_resume_match_deck", {
			p_account_id: accountId,
			p_orientation: orientation,
			// The generated Args type has no way to express "TEXT, nullable at the SQL
			// level" (codegen types every function TEXT param as non-null `string`),
			// but the RPC itself is happy to receive NULL here — cast to bridge that
			// gap rather than widen the generated type.
			p_visibility_config_hash: visibilityConfigHash as string,
			p_window: window,
		}),
	);
	if (Result.isError(result) || !("unrecognized" in result.value)) {
		return result;
	}
	// A drifted active payload has no call-site capture (the resolver treats it
	// as a miss), so it is reported here alongside an unknown status.
	const status = result.value.status;
	const knownStatus = status === "active" || status === "miss";
	captureServerError(
		new Error(
			knownStatus
				? `start_or_resume_match_deck returned a malformed ${status} payload`
				: `start_or_resume_match_deck returned an unknown status: ${status}`,
		),
		{
			area: "match_review_queue",
			operation: "call_start_or_resume_match_deck",
			accountId,
			extra: { orientation, status },
		},
	);
	return result;
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
	const result = await fromSupabaseRpc(
		ReadMatchDeckCardResultSchema,
		createAdminSupabaseClient().rpc("read_match_deck_card", {
			p_item_id: itemId,
			p_account_id: accountId,
			p_limit: limit,
			p_mark_presented: markPresented,
		}),
	);
	if (Result.isError(result)) return result;
	const status = result.value.status;
	if (!KNOWN_CARD_STATUSES.has(status)) {
		captureServerError(
			new Error(`read_match_deck_card returned an unknown status: ${status}`),
			{
				area: "match_review_queue",
				operation: "call_read_match_deck_card",
				accountId,
				extra: { itemId, status },
			},
		);
	}
	return result;
}
