/**
 * Match decision data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMany,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables } from "@/lib/data/database.types";

export type MatchDecision = Tables<"match_decision">;
export type DecisionType = "added" | "dismissed";

/**
 * Upserts a single match decision.
 * On conflict (same account + song + playlist), updates the decision and decided_at.
 */
export function insertMatchDecision(
	accountId: string,
	songId: string,
	playlistId: string,
	decision: DecisionType,
): Promise<Result<MatchDecision, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("match_decision")
			.upsert(
				{
					account_id: accountId,
					song_id: songId,
					playlist_id: playlistId,
					decision,
					decided_at: new Date().toISOString(),
				},
				{ onConflict: "account_id,song_id,playlist_id" },
			)
			.select()
			.single(),
	);
}

/**
 * Batch upserts match decisions.
 * On conflict (same account + song + playlist), updates the decision and decided_at.
 */
export function insertMatchDecisions(
	decisions: {
		accountId: string;
		songId: string;
		playlistId: string;
		decision: DecisionType;
	}[],
): Promise<Result<MatchDecision[], DbError>> {
	if (decisions.length === 0) {
		return Promise.resolve(Result.ok<MatchDecision[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_decision")
			.upsert(
				decisions.map((d) => ({
					account_id: d.accountId,
					song_id: d.songId,
					playlist_id: d.playlistId,
					decision: d.decision,
					decided_at: new Date().toISOString(),
				})),
				{ onConflict: "account_id,song_id,playlist_id" },
			)
			.select(),
	);
}

/**
 * Gets all match decisions for an account.
 * Returns empty array if none found.
 */
export function getMatchDecisions(
	accountId: string,
): Promise<Result<MatchDecision[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_decision")
			.select("*")
			.eq("account_id", accountId)
			.order("decided_at", { ascending: false }),
	);
}

/**
 * Gets match decisions for specific songs belonging to an account.
 * Returns empty array if none found.
 */
export function getMatchDecisionsForSongs(
	accountId: string,
	songIds: string[],
): Promise<Result<MatchDecision[], DbError>> {
	if (songIds.length === 0) {
		return Promise.resolve(Result.ok<MatchDecision[], DbError>([]));
	}

	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("match_decision")
			.select("*")
			.eq("account_id", accountId)
			.in("song_id", songIds)
			.order("decided_at", { ascending: false }),
	);
}
