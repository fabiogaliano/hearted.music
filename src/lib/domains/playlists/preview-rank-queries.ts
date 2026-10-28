/**
 * The studio preview's ranking, computed in Postgres by
 * rank_playlist_draft_preview (migration 20261028130200).
 *
 * The function reproduces the TypeScript reference — loadPhase1Candidates →
 * selectEligibleCandidates → buildDraftProfile → rankCandidates — next to the
 * data, so neither the candidate library nor the stored song vectors cross the
 * wire; only the rows composePlaylistPreview reads come back.
 */

import type { Result } from "better-result";
import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/data/client";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseRpc } from "@/lib/shared/utils/result-wrappers/supabase";
import type { RankedSong } from "./draft-engine";

const RankedRowSchema = z
	.object({
		song_id: z.string(),
		score: z.number(),
		spotify_id: z.string(),
		name: z.string(),
		artists: z.array(z.string()),
		genres: z.array(z.string()),
		image_url: z.string().nullable(),
		album_name: z.string().nullable(),
		duration_ms: z.number().nullable(),
	})
	.transform(
		(row): RankedSong => ({
			candidate: {
				song: {
					id: row.song_id,
					spotifyId: row.spotify_id,
					name: row.name,
					artists: row.artists,
					genres: row.genres,
				},
				display: {
					imageUrl: row.image_url,
					album: row.album_name,
					durationMs: row.duration_ms,
				},
			},
			score: row.score,
		}),
	);

const PreviewRankingSchema = z
	.object({
		total_eligible: z.number(),
		ranked_pool_count: z.number(),
		ranked: z.array(RankedRowSchema),
		pinned: z.array(RankedRowSchema),
	})
	.transform((value) => ({
		totalEligible: value.total_eligible,
		rankedPoolCount: value.ranked_pool_count,
		ranked: value.ranked,
		pinned: value.pinned,
	}));

export type PreviewRanking = z.infer<typeof PreviewRankingSchema>;

export interface PreviewRankInput {
	matchFilters: PlaylistMatchFiltersV1;
	genrePills: string[];
	/** The embedded intent and the model whose stored song vectors it is compared with. */
	intent: { embedding: number[]; model: string } | null;
	pinnedSongIds: string[];
	excludedSongIds: string[];
	/** How many of the top non-pinned, non-excluded rows to return. */
	rankedLimit: number;
	/** Resolves a liked-date range that ends "today". */
	now: Date;
}

/**
 * Rank the account's Phase-1 candidates for the studio preview.
 *
 * `pinned` holds every pinned song that is a candidate, scored, even when the
 * match filters would drop it. `ranked` holds the top `rankedLimit` of the
 * remaining candidates (filter-eligible, not pinned, not excluded) in ranking
 * order: score, then most recently liked, then song id.
 */
export function rankPreviewCandidates(
	supabase: AdminSupabaseClient,
	accountId: string,
	input: PreviewRankInput,
): Promise<Result<PreviewRanking, DbError>> {
	return fromSupabaseRpc(
		PreviewRankingSchema,
		supabase.rpc("rank_playlist_draft_preview", {
			p_account_id: accountId,
			p_match_filters: input.matchFilters,
			p_genre_pills: input.genrePills,
			p_pinned_song_ids: input.pinnedSongIds,
			p_excluded_song_ids: input.excludedSongIds,
			p_ranked_limit: input.rankedLimit,
			p_now: input.now.toISOString(),
			...(input.intent && {
				p_intent_embedding: JSON.stringify(input.intent.embedding),
				p_embedding_model: input.intent.model,
			}),
		}),
	);
}
