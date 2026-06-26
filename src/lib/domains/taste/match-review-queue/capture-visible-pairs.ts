/**
 * Capture visible pairs — TypeScript client for the atomic capture RPC (MSR-23).
 *
 * The RPC implements a first-write-wins capture so retries and multi-tab races
 * always return the same visible ranks that were shown to the user on first
 * presentation.
 *
 * Terminology (from match-system-terminology-decisions.md):
 *  B5  — model_rank (snapshot rank) / visible_rank (dense user-visible rank)
 *  B11 — RPC status values: captured, already_captured, empty, not_found,
 *         already_resolved, invalid_input
 *  D3  — RPC name: capture_match_review_item_visible_pairs_atomic
 *  D4  — pair input fields: song_id, playlist_id, model_rank, visible_rank, fit_score
 */

import { createAdminSupabaseClient } from "@/lib/data/client";
import type { VisibleSuggestion } from "@/lib/domains/taste/match-review-queue/visible-suggestion-list";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";

/** A single pair row as returned by the `already_captured` idempotent path. */
export interface CapturedVisiblePair {
	songId: string;
	playlistId: string;
	modelRank: number;
	visibleRank: number;
	fitScore: number;
}

/** Typed result discriminated by the status string returned by the RPC (B11). */
export type CaptureVisiblePairsResult =
	| { status: "captured" }
	| { status: "already_captured"; pairs: CapturedVisiblePair[] }
	| { status: "empty" }
	| { status: "not_found" }
	| { status: "already_resolved" }
	| { status: "invalid_input"; reason: string }
	| { status: "db-error"; error: DbError };

// The set of status strings the RPC can return — used to validate the response
// at the TypeScript boundary without an unsafe cast.
const VALID_STATUSES = new Set([
	"captured",
	"already_captured",
	"empty",
	"not_found",
	"already_resolved",
	"invalid_input",
] as const);

type KnownStatus = typeof VALID_STATUSES extends Set<infer T> ? T : never;

function isKnownStatus(s: unknown): s is KnownStatus {
	return typeof s === "string" && (VALID_STATUSES as Set<string>).has(s);
}

/**
 * Parses the `pairs` field from an `already_captured` response into
 * `CapturedVisiblePair[]`. Returns null if the shape is not as expected so the
 * caller can treat it as a db-error rather than surfacing an uncaught cast.
 */
function parsePairs(raw: unknown): CapturedVisiblePair[] | null {
	if (!Array.isArray(raw)) return null;
	const result: CapturedVisiblePair[] = [];
	for (const item of raw) {
		if (
			typeof item !== "object" ||
			item === null ||
			typeof (item as Record<string, unknown>).song_id !== "string" ||
			typeof (item as Record<string, unknown>).playlist_id !== "string" ||
			typeof (item as Record<string, unknown>).model_rank !== "number" ||
			typeof (item as Record<string, unknown>).visible_rank !== "number" ||
			typeof (item as Record<string, unknown>).fit_score !== "number"
		) {
			return null;
		}
		const row = item as {
			song_id: string;
			playlist_id: string;
			model_rank: number;
			visible_rank: number;
			fit_score: number;
		};
		result.push({
			songId: row.song_id,
			playlistId: row.playlist_id,
			modelRank: row.model_rank,
			visibleRank: row.visible_rank,
			fitScore: row.fit_score,
		});
	}
	return result;
}

/**
 * Atomically captures the visible suggestion list for a queue item.
 *
 * Converts `VisibleSuggestion[]` (from `computeVisibleSuggestionList`) into the
 * snake_case payload the RPC expects, then maps the JSONB response back to the
 * typed `CaptureVisiblePairsResult` discriminated union.
 *
 * First capture wins: subsequent calls return `already_captured` with the
 * original rows ordered by visible_rank, ignoring the new `suggestions` input.
 * An empty `suggestions` array is valid — the capture timestamp and active
 * state are still set, and the result is `{ status: 'empty' }`.
 */
export async function captureVisiblePairsAtomic(
	itemId: string,
	accountId: string,
	suggestions: readonly VisibleSuggestion[],
): Promise<CaptureVisiblePairsResult> {
	const supabase = createAdminSupabaseClient();

	const pairsPayload = suggestions.map((s) => ({
		song_id: s.songId,
		playlist_id: s.playlistId,
		model_rank: s.modelRank,
		visible_rank: s.visibleRank,
		fit_score: s.fitScore,
	}));

	const { data, error } = await supabase.rpc(
		"capture_match_review_item_visible_pairs_atomic",
		{
			p_item_id: itemId,
			p_account_id: accountId,
			p_pairs: pairsPayload,
		},
	);

	if (error !== null) {
		return {
			status: "db-error",
			error: new DatabaseError({ code: error.code, message: error.message }),
		};
	}

	if (typeof data !== "object" || data === null) {
		return {
			status: "db-error",
			error: new DatabaseError({
				code: "UNEXPECTED_RESPONSE",
				message: "RPC returned unexpected shape",
			}),
		};
	}

	const response = data as Record<string, unknown>;
	const status = response["status"];

	if (!isKnownStatus(status)) {
		return {
			status: "db-error",
			error: new DatabaseError({
				code: "UNEXPECTED_RESPONSE",
				message: `Unknown RPC status: ${String(status)}`,
			}),
		};
	}

	if (status === "already_captured") {
		const pairs = parsePairs(response["pairs"]);
		if (pairs === null) {
			return {
				status: "db-error",
				error: new DatabaseError({
					code: "UNEXPECTED_RESPONSE",
					message: "already_captured response contained invalid pairs shape",
				}),
			};
		}
		return { status: "already_captured", pairs };
	}

	if (status === "invalid_input") {
		return {
			status: "invalid_input",
			reason:
				typeof response["reason"] === "string" ? response["reason"] : "unknown",
		};
	}

	return { status };
}
