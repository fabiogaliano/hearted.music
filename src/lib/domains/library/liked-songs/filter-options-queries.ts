/**
 * Match-filter option aggregates over the matching-eligible population (the
 * set select_entitled_data_enriched_liked_song_ids returns), so option counts
 * and bounds stay aligned with what matching sees. The population and all
 * aggregation live in the get_account_match_filter_options RPC; no song-id set ever
 * leaves the database.
 */

import type { Result } from "better-result";
import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/data/client";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseRpc } from "@/lib/shared/utils/result-wrappers/supabase";

const YearCountSchema = z.object({ year: z.number(), count: z.number() });

const ReleaseYearAggregateSchema = z.object({
	min: z.number().nullable(),
	max: z.number().nullable(),
	counts: z.array(YearCountSchema),
});

export type ReleaseYearAggregate = z.infer<typeof ReleaseYearAggregateSchema>;

const MatchFilterOptionAggregatesSchema = z.object({
	/** Every detected code, catalogued or not; a song counts once per code. */
	languages: z.array(z.object({ code: z.string(), count: z.number() })),
	releaseYears: ReleaseYearAggregateSchema,
	likedAt: z.object({
		/** Oldest active like as a UTC YYYY-MM-DD date. */
		oldest: z.string().nullable(),
		yearCounts: z.array(YearCountSchema),
	}),
});

export type MatchFilterOptionAggregates = z.infer<
	typeof MatchFilterOptionAggregatesSchema
>;

export function readMatchFilterOptions(
	supabase: AdminSupabaseClient,
	accountId: string,
): Promise<Result<MatchFilterOptionAggregates, DbError>> {
	return fromSupabaseRpc(
		MatchFilterOptionAggregatesSchema,
		supabase.rpc("get_account_match_filter_options", {
			p_account_id: accountId,
		}),
	);
}
