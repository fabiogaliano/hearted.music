/**
 * Persistence for instrumental-classification reviews.
 *
 * When content analysis concludes a lyric-less song is instrumental from genre /
 * instrumentalness (a heuristic that occasionally mislabels a vocal track), it
 * logs a 'pending' row here for an operator to approve or reject in the control
 * panel — mirroring how auto-backfilled audio features go live then get reviewed.
 *
 * A 'rejected' row is the operator's standing veto: the analyzer reads it before
 * ever auto-classifying that song instrumental again, so a rejected vocal track
 * can't bounce back into the instrumental state.
 *
 * Service role bypasses RLS (deny-all); these rows are written by the worker, not
 * end users.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMaybe } from "@/lib/shared/utils/result-wrappers/supabase";

export type InstrumentalReviewSignal = "instrumentalness" | "genre";

export interface PendingInstrumentalReviewInput {
	songId: string;
	signal: InstrumentalReviewSignal;
	instrumentalness?: number | null;
	matchedGenre?: string | null;
}

/**
 * True when the operator has rejected an instrumental verdict for this song
 * ("it has vocals"). The analyzer treats this as a veto on the genre /
 * instrumentalness heuristic. Best-effort: a read error returns false so a
 * transient failure never blocks normal instrumental classification — the rare
 * rejected song would simply re-surface for review, which self-corrects.
 */
export async function hasRejectedInstrumentalReview(
	songId: string,
): Promise<boolean> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe<{ id: string }>(
		supabase
			.from("song_instrumental_review")
			.select("id")
			.eq("song_id", songId)
			.eq("status", "rejected")
			.single(),
	);
	if (Result.isError(result)) return false;
	return result.value !== null;
}

/**
 * Records a 'pending' review for a fresh instrumental determination. Conflict
 * target is (song_id): never clobbers an existing operator verdict (approved /
 * rejected) — the analyzer only reaches this on a song's first analysis, but the
 * ignore-on-conflict keeps it safe if it ever re-runs.
 */
export async function upsertPendingInstrumentalReview(
	input: PendingInstrumentalReviewInput,
): Promise<Result<{ id: string } | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	// ignoreDuplicates returns no row when a verdict already exists, so the select
	// must tolerate zero rows (maybeSingle) rather than require exactly one.
	return fromSupabaseMaybe<{ id: string }>(
		supabase
			.from("song_instrumental_review")
			.upsert(
				{
					song_id: input.songId,
					status: "pending",
					signal: input.signal,
					instrumentalness: input.instrumentalness ?? null,
					matched_genre: input.matchedGenre ?? null,
				},
				{ onConflict: "song_id", ignoreDuplicates: true },
			)
			.select("id")
			.single(),
	);
}
