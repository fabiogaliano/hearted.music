import { Result } from "better-result";
import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/data/client";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import { parseStoredMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import type { MatchResultRow } from "@/lib/domains/taste/song-matching/queries";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseRpc } from "@/lib/shared/utils/result-wrappers/supabase";

export type VisibilityScope = { accountId: string; snapshotId: string } & (
	| { kind: "account" }
	| { kind: "song"; songId: string }
	| { kind: "playlist"; playlistId: string }
);

export interface VisibilityInputs {
	/** Snapshot pairs in scope, minus pairs whose song is already in the playlist. */
	pairs: MatchResultRow[];
	entitledSongIds: ReadonlySet<string>;
	ownedPlaylistIds: ReadonlySet<string>;
	/** `${songId}:${playlistId}` keys of pairs the account already decided. */
	decidedPairs: ReadonlySet<string>;
	songMetaBySongId: ReadonlyMap<string, SongFilterMetadata>;
	/** Filters of every playlist that appears in the pairs, target or not. */
	filtersByPlaylistId: ReadonlyMap<string, PlaylistMatchFiltersV1>;
	playlistsById: ReadonlyMap<string, { name: string; spotifyId: string }>;
}

const VisibilityInputRowsSchema = z.array(
	z.object({
		song_id: z.string(),
		playlist_id: z.string(),
		score: z.number(),
		fused_score: z.number().nullable(),
		song_entitled: z.boolean(),
		playlist_owned: z.boolean(),
		decided: z.boolean(),
		language: z.string().nullable(),
		language_secondary: z.string().nullable(),
		release_year: z.number().nullable(),
		vocal_gender: z.string().nullable(),
		liked_at: z.string().nullable(),
		match_filters: z.unknown(),
		playlist_name: z.string(),
		playlist_spotify_id: z.string(),
	}),
);

type VisibilityInputRow = z.infer<typeof VisibilityInputRowsSchema>[number];

// PostgREST caps every response at max_rows (1,000 in prod). The page size must
// not exceed it, or a capped page would read as the last one.
const PAGE_SIZE = 1000;

/** Everything the visibility policy needs about one account's match pairs, joined in SQL so no DB-derived id re-enters a query. */
export async function loadVisibilityInputs(
	supabase: AdminSupabaseClient,
	scope: VisibilityScope,
): Promise<Result<VisibilityInputs, DbError>> {
	const args = {
		p_account_id: scope.accountId,
		p_snapshot_id: scope.snapshotId,
		p_song_id: scope.kind === "song" ? scope.songId : undefined,
		p_playlist_id: scope.kind === "playlist" ? scope.playlistId : undefined,
	};

	const rows: VisibilityInputRow[] = [];
	for (;;) {
		const page = await fromSupabaseRpc(
			VisibilityInputRowsSchema,
			supabase
				.rpc("select_match_visibility_inputs", args)
				.order("song_id")
				.order("playlist_id")
				.range(rows.length, rows.length + PAGE_SIZE - 1),
		);
		if (Result.isError(page)) return page;
		rows.push(...page.value);
		if (page.value.length < PAGE_SIZE) break;
	}

	return Result.ok(toVisibilityInputs(rows));
}

function toVisibilityInputs(rows: VisibilityInputRow[]): VisibilityInputs {
	const pairs: MatchResultRow[] = [];
	const entitledSongIds = new Set<string>();
	const ownedPlaylistIds = new Set<string>();
	const decidedPairs = new Set<string>();
	const songMetaBySongId = new Map<string, SongFilterMetadata>();
	const filtersByPlaylistId = new Map<string, PlaylistMatchFiltersV1>();
	const playlistsById = new Map<string, { name: string; spotifyId: string }>();

	for (const row of rows) {
		pairs.push({
			song_id: row.song_id,
			playlist_id: row.playlist_id,
			score: row.score,
			fused_score: row.fused_score,
		});
		if (row.song_entitled) entitledSongIds.add(row.song_id);
		if (row.playlist_owned) ownedPlaylistIds.add(row.playlist_id);
		if (row.decided) decidedPairs.add(`${row.song_id}:${row.playlist_id}`);
		if (!songMetaBySongId.has(row.song_id)) {
			songMetaBySongId.set(row.song_id, {
				language: row.language,
				languageSecondary: row.language_secondary,
				releaseYear: row.release_year,
				vocalGender: row.vocal_gender,
				likedAt: row.liked_at === null ? null : Date.parse(row.liked_at),
			});
		}
		if (!filtersByPlaylistId.has(row.playlist_id)) {
			filtersByPlaylistId.set(
				row.playlist_id,
				parseStoredMatchFilters(row.match_filters).value,
			);
			playlistsById.set(row.playlist_id, {
				name: row.playlist_name,
				spotifyId: row.playlist_spotify_id,
			});
		}
	}

	return {
		pairs,
		entitledSongIds,
		ownedPlaylistIds,
		decidedPairs,
		songMetaBySongId,
		filtersByPlaylistId,
		playlistsById,
	};
}
