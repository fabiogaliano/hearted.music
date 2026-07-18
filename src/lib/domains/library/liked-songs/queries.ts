/**
 * Liked song and processing status operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Database, Tables, TablesInsert } from "@/lib/data/database.types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	chunkedWrite,
	DB_IN_FILTER_CHUNK_SIZE,
} from "@/lib/shared/utils/chunked-write";
import { chunkArray } from "@/lib/shared/utils/concurrency";
import {
	fromSupabaseMany,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
// RPC results are typed via LikedSongPageRow (derived from the generated
// Database["public"]["Functions"] return type), so fromSupabaseMany's
// generic `T[] | null` shape is reused as-is instead of adding a parallel
// zod-validated RPC wrapper — the generated types already are the schema.
import { generateSongSlug } from "@/lib/utils/slug";
import {
	LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS,
	LIKED_SONGS_PAGE_SIZE,
} from "./constants";

/** Liked song row type */
export type LikedSong = Tables<"liked_song">;

/** Insert type for upserting liked songs */
export type UpsertData = Pick<
	TablesInsert<"liked_song">,
	"song_id" | "liked_at"
>;

/** Liked song with joined song details for activity feed */
export interface LikedSongWithDetails {
	id: string;
	liked_at: string;
	song: {
		id: string;
		name: string;
		artists: string[];
		image_url: string | null;
	};
}

/** Row returned from get_liked_songs_page RPC function (inferred from DB types) */
export type LikedSongPageRow =
	Database["public"]["Functions"]["get_liked_songs_page"]["Returns"][number];

/** Stats row returned from get_liked_songs_stats RPC function */
export type LikedSongsStatsRow =
	Database["public"]["Functions"]["get_liked_songs_stats"]["Returns"][number];

/** Filter options for liked songs page */
export type LikedSongFilter =
	| "all"
	| "pending"
	| "has_suggestions"
	| "acted"
	| "no_suggestions"
	| "analyzed";

/** The liked-song fields the diff/analysis sweeps read — never the full row. */
export type LikedSongRef = Pick<LikedSong, "song_id" | "unliked_at">;

/**
 * Gets all liked-song refs for an account, newest first.
 * Returns empty array if none found.
 *
 * Projects to `song_id` + `unliked_at` only: this feeds whole-library sweeps (sync
 * diff, analysis backfill), where `select("*")` would haul every column for
 * thousands of rows when callers only key off the id and soft-delete flag.
 * Soft-deleted rows are intentionally kept — the sync diff needs them to detect
 * re-likes (see incrementalSync).
 */
export function getAll(
	accountId: string,
): Promise<Result<LikedSongRef[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("liked_song")
			.select("song_id, unliked_at")
			.eq("account_id", accountId)
			.order("liked_at", { ascending: false }),
	);
}

/**
 * Counts liked songs for an account (efficient - no data transfer).
 * Uses Supabase's count feature for O(1) DB operation.
 */
export async function getCount(
	accountId: string,
): Promise<Result<number, DbError>> {
	const supabase = createAdminSupabaseClient();
	const { count, error } = await supabase
		.from("liked_song")
		.select("*", { count: "exact", head: true })
		.eq("account_id", accountId);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(count ?? 0);
}

/**
 * Returns true when the account currently likes the given song.
 *
 * A song is "owned" when an un-unliked `liked_song` row exists for the
 * account. Returns false on query error (treat ambiguity as not-owned), so
 * callers can use it directly as an authorization guard.
 */
export async function isSongOwnedByAccount(
	accountId: string,
	songId: string,
): Promise<boolean> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("liked_song")
		.select("song_id")
		.eq("account_id", accountId)
		.eq("song_id", songId)
		.is("unliked_at", null)
		.maybeSingle();

	return !error && Boolean(data);
}

/**
 * Filters `songIds` down to the ones the account currently likes (un-unliked
 * `liked_song` rows). Used as a server-side ownership guard before resolving
 * track URIs or recording match decisions from a client-supplied draft:
 * callers MUST drop any id not in the returned set, so a tampered request can't
 * act on songs the account never liked.
 *
 * `songIds` is an externally-sourced (request) list, so chunked `.in()` reads
 * are the sanctioned path here — the CLAUDE.md ban targets DB-derived id sets,
 * not caller-supplied ones. Returns an error Result on any chunk failure so
 * callers fail closed rather than under-filter.
 */
export async function selectOwnedSongIds(
	accountId: string,
	songIds: string[],
): Promise<Result<Set<string>, DbError>> {
	if (songIds.length === 0) {
		return Result.ok(new Set<string>());
	}

	const supabase = createAdminSupabaseClient();
	const owned = new Set<string>();

	for (const chunk of chunkArray(songIds, DB_IN_FILTER_CHUNK_SIZE)) {
		const { data, error } = await supabase
			.from("liked_song")
			.select("song_id")
			.eq("account_id", accountId)
			.is("unliked_at", null)
			.in("song_id", chunk);

		if (error) {
			return Result.err(
				new DatabaseError({ code: error.code, message: error.message }),
			);
		}

		for (const row of data ?? []) {
			owned.add(row.song_id);
		}
	}

	return Result.ok(owned);
}

/**
 * Gets recent liked songs with song details for activity feed.
 * Uses Supabase foreign key join to fetch song name, artists, and image.
 */
export async function getRecentWithDetails(
	accountId: string,
	limit = 10,
): Promise<Result<LikedSongWithDetails[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase
		.from("liked_song")
		.select(
			`
			id,
			liked_at,
			song:song_id (
				id,
				name,
				artists,
				image_url
			)
		`,
		)
		.eq("account_id", accountId)
		.is("unliked_at", null)
		.order("liked_at", { ascending: false })
		.limit(limit);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	// Supabase returns song as object or null; filter out nulls and cast
	const filtered = (data ?? []).filter(
		(row): row is LikedSongWithDetails => row.song !== null,
	);

	return Result.ok(filtered);
}

/**
 * Pagination cursor encoding. Many rows can share a `liked_at` (a bulk import
 * stamped 76 songs with one timestamp), so a `liked_at`-only cursor compared with
 * a strict `<` skips every tied row past a page boundary — deep songs vanish from
 * the walk. The cursor is therefore the composite key `liked_at|id`, matching the
 * function's `(liked_at DESC, id DESC)` order and its `(liked_at, id)` tuple
 * comparison. The `|` separator is safe: neither a timestamp nor a uuid contains
 * it. A separator-less value decodes as a legacy `liked_at`-only cursor (id null),
 * so any cursor already in flight keeps working.
 */
function encodeCursor(likedAt: string, id: string): string {
	return `${likedAt}|${id}`;
}

function decodeCursor(cursor: string | undefined): {
	likedAt: string | undefined;
	id: string | undefined;
} {
	if (!cursor) {
		return { likedAt: undefined, id: undefined };
	}
	const separator = cursor.indexOf("|");
	if (separator === -1) {
		return { likedAt: cursor, id: undefined };
	}
	return {
		likedAt: cursor.slice(0, separator),
		id: cursor.slice(separator + 1),
	};
}

/**
 * Gets a page of liked songs with full details (song + analysis) for the UI.
 * Uses RPC function for efficient single-query fetch with JOINs.
 * Cursor-based pagination using the composite `liked_at|id` key (see encodeCursor).
 */
export async function getPageWithDetails(
	accountId: string,
	options: {
		cursor?: string;
		limit?: number;
		filter?: LikedSongFilter;
		search?: string;
		minScore?: number;
	} = {},
): Promise<
	Result<{ items: LikedSongPageRow[]; nextCursor: string | null }, DbError>
> {
	const supabase = createAdminSupabaseClient();
	const limit = options.limit ?? 50;
	const trimmedSearch = options.search?.trim();
	const search =
		trimmedSearch && trimmedSearch.length > 0 ? trimmedSearch : undefined;

	const { likedAt: cursorLikedAt, id: cursorId } = decodeCursor(options.cursor);

	const rowsResult = await fromSupabaseMany<LikedSongPageRow>(
		supabase.rpc("get_liked_songs_page", {
			p_account_id: accountId,
			p_cursor: cursorLikedAt,
			p_cursor_id: cursorId,
			p_limit: limit,
			p_filter: options.filter ?? "all",
			p_search: search,
			p_min_score: options.minScore ?? 0,
		}),
	);

	if (Result.isError(rowsResult)) {
		return rowsResult;
	}

	const rows = rowsResult.value;
	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const lastItem = items[items.length - 1];
	const nextCursor = hasMore
		? encodeCursor(lastItem.liked_at, lastItem.id)
		: null;

	return Result.ok({ items, nextCursor });
}

/**
 * Finds a liked song row by its deep-link slug in a single indexed lookup.
 *
 * `get_liked_song_by_slug` resolves the slug at the database level via the
 * `idx_song_slug` expression index — the SQL `song_slug()` mirrors
 * `generateSongSlug` — and returns the newest active match in the exact row
 * shape the list uses. No library walk: O(1) round-trips regardless of how deep
 * the song sits, and a missing slug is one query, not a full scan.
 */
export async function getPageRowBySlug(
	accountId: string,
	slug: string,
	minScore = 0,
): Promise<Result<LikedSongPageRow | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const rowsResult = await fromSupabaseMany<LikedSongPageRow>(
		supabase.rpc("get_liked_song_by_slug", {
			p_account_id: accountId,
			p_slug: slug,
			p_min_score: minScore,
		}),
	);

	return Result.map(rowsResult, (rows) => rows[0] ?? null);
}

/** Single source of truth for the deep-link slug a page row resolves to. */
function pageRowMatchesSlug(row: LikedSongPageRow, slug: string): boolean {
	return (
		generateSongSlug(row.song_artists[0] ?? "Unknown Artist", row.song_name) ===
		slug
	);
}

/** A list page shaped exactly like the client's infinite-query page. */
export interface LikedSongsBootstrapPage {
	items: LikedSongPageRow[];
	nextCursor: string | null;
}

export interface LikedSongsBootstrapPages {
	selectedRow: LikedSongPageRow | null;
	pages: LikedSongsBootstrapPage[];
}

/**
 * Rechunks a contiguous (newest-first) run of rows into client-sized pages,
 * deriving each page's cursor the same way `getPageWithDetails` does: the
 * composite `liked_at|id` of the page's last row. Only the final page can
 * terminate the sequence (`nextCursor: null`), and only when no rows follow it in
 * the library.
 */
function chunkBootstrapRows(
	rows: LikedSongPageRow[],
	hasMoreAfterLast: boolean,
): LikedSongsBootstrapPage[] {
	if (rows.length === 0) {
		return [{ items: [], nextCursor: null }];
	}

	const chunks = chunkArray(rows, LIKED_SONGS_PAGE_SIZE);
	return chunks.map((items, index) => {
		const isLast = index === chunks.length - 1;
		const lastItem = items[items.length - 1];
		const lastCursor = encodeCursor(lastItem.liked_at, lastItem.id);
		return {
			items,
			nextCursor: isLast ? (hasMoreAfterLast ? lastCursor : null) : lastCursor,
		};
	});
}

/**
 * Builds the deep-link bootstrap for a slug in a single query.
 *
 * `get_liked_songs_bootstrap_by_slug` resolves the slug to its anchor (the newest
 * active match, via the `idx_song_slug` index) and returns, newest-first, the
 * contiguous prefix from the newest liked song through the selected one followed
 * by up to `LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS + 1` older rows. The `+ 1` is a
 * sentinel: more trailing rows than the buffer means older songs still follow the
 * seeded tail, so the final page keeps a non-null cursor. The rows are rechunked
 * into client-sized pages with cursors derived exactly as `getPageWithDetails`
 * does, so seeding the infinite query with them is byte-identical to having
 * paginated there from the top.
 *
 * Missing / bogus slug: the RPC returns no rows, indistinguishable from an empty
 * library and treated the same — fall back to the canonical first page with
 * `selectedRow: null`, so the list still renders and the panel stays closed.
 *
 * The anchor is the only slug match in the prefix (it is the *newest* match), so
 * `pageRowMatchesSlug` locates the selection by the same slug the caller passed.
 */
export async function getBootstrapPagesBySlug(
	accountId: string,
	slug: string,
	minScore = 0,
): Promise<Result<LikedSongsBootstrapPages, DbError>> {
	const supabase = createAdminSupabaseClient();
	const rowsResult = await fromSupabaseMany<LikedSongPageRow>(
		supabase.rpc("get_liked_songs_bootstrap_by_slug", {
			p_account_id: accountId,
			p_slug: slug,
			p_trailing_limit: LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS,
			p_min_score: minScore,
		}),
	);

	if (Result.isError(rowsResult)) {
		return rowsResult;
	}

	const rows = rowsResult.value;
	const matchIndex = rows.findIndex((row) => pageRowMatchesSlug(row, slug));

	if (matchIndex === -1) {
		return buildCanonicalFirstPage(accountId, minScore);
	}

	const prefixThroughMatch = rows.slice(0, matchIndex + 1);
	const trailing = rows.slice(matchIndex + 1);
	const hasMoreAfterLast =
		trailing.length > LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS;
	const seededTrailing = hasMoreAfterLast
		? trailing.slice(0, LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS)
		: trailing;

	return Result.ok({
		selectedRow: rows[matchIndex],
		pages: chunkBootstrapRows(
			[...prefixThroughMatch, ...seededTrailing],
			hasMoreAfterLast,
		),
	});
}

/**
 * The fallback when a slug resolves to nothing: the canonical first page, shaped
 * exactly like a normal `limit = LIKED_SONGS_PAGE_SIZE` infinite-query page so
 * the list renders normally with no selection.
 */
async function buildCanonicalFirstPage(
	accountId: string,
	minScore = 0,
): Promise<Result<LikedSongsBootstrapPages, DbError>> {
	const firstPageResult = await getPageWithDetails(accountId, {
		filter: "all",
		limit: LIKED_SONGS_PAGE_SIZE,
		minScore,
	});
	if (Result.isError(firstPageResult)) {
		return Result.err(firstPageResult.error);
	}

	const { items, nextCursor } = firstPageResult.value;
	return Result.ok({
		selectedRow: null,
		pages: chunkBootstrapRows(items, nextCursor !== null),
	});
}

/**
 * Gets aggregate stats for liked songs (total, analyzed, sorted, unsorted).
 * Single efficient query independent of pagination.
 */
export async function getStats(
	accountId: string,
	minScore = 0,
): Promise<Result<LikedSongsStatsRow, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase
		.rpc("get_liked_songs_stats", {
			p_account_id: accountId,
			p_min_score: minScore,
		})
		.single();

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(data);
}

/** One genre tag and how often it appears across the account's liked songs. */
export interface AccountTopGenre {
	genre: string;
	occurrences: number;
}

/**
 * Top genre tags across an account's still-liked songs, most frequent first.
 * Backs the genre-pills picker's quick-picks so every suggestion is a genre the
 * user actually owns. Returns raw (non-canonicalized) tags — the caller
 * canonicalizes + dedupes, since the whitelist ships both spellings.
 */
export async function getAccountTopGenres(
	accountId: string,
	limit = 12,
): Promise<Result<AccountTopGenre[], DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc("get_account_top_genres", {
		p_account_id: accountId,
		p_limit: limit,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(
		(data ?? []).map((row) => ({
			genre: row.genre,
			occurrences: Number(row.occurrences),
		})),
	);
}

/**
 * Creates or updates liked songs for an account.
 * Uses (account_id, song_id) as the conflict target.
 * Returns all upserted liked songs.
 *
 * `unliked_at: null` is written on every row so the upsert is self-healing: a
 * previously unliked song that gets re-liked has its soft-delete cleared instead
 * of being silently left out of the library. Omitting it would make
 * `ON CONFLICT DO UPDATE` leave a stale `unliked_at` in place.
 */
export function upsert(
	accountId: string,
	data: UpsertData[],
): Promise<Result<LikedSong[], DbError>> {
	if (data.length === 0) {
		return Promise.resolve(Result.ok<LikedSong[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return chunkedWrite(data, (chunk) =>
		fromSupabaseMany(
			supabase
				.from("liked_song")
				.upsert(
					chunk.map((ls) => ({
						account_id: accountId,
						song_id: ls.song_id,
						liked_at: ls.liked_at,
						unliked_at: null,
					})),
					{ onConflict: "account_id,song_id" },
				)
				.select(),
		),
	);
}

/**
 * Soft deletes a liked song for an account by setting unliked_at.
 * Preserves timeline history for analytics.
 */
export function softDelete(
	accountId: string,
	songId: string,
): Promise<Result<LikedSong, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("liked_song")
			.update({ unliked_at: new Date().toISOString() })
			.eq("account_id", accountId)
			.eq("song_id", songId)
			.select()
			.single(),
	);
}

/**
 * Batch soft deletes liked songs for an account by setting unliked_at.
 * O(1) DB call instead of O(n) sequential calls.
 * Preserves timeline history for analytics.
 */
export function softDeleteBatch(
	accountId: string,
	songIds: string[],
): Promise<Result<LikedSong[], DbError>> {
	if (songIds.length === 0) {
		return Promise.resolve(Result.ok<LikedSong[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	// Stamp every chunk with one timestamp so a mass-unlike doesn't smear
	// unliked_at across the rows just because they spanned chunk boundaries.
	const unlikedAt = new Date().toISOString();
	return chunkedWrite(
		songIds,
		(chunk) =>
			fromSupabaseMany(
				supabase
					.from("liked_song")
					.update({ unliked_at: unlikedAt })
					.eq("account_id", accountId)
					.in("song_id", chunk)
					.select(),
			),
		{ chunkSize: DB_IN_FILTER_CHUNK_SIZE, concurrency: 4 },
	);
}
