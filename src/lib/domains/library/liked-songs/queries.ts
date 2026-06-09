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
import { chunkArray, mapWithConcurrency } from "@/lib/shared/utils/concurrency";
import {
	fromSupabaseMany,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { generateSongSlug } from "@/lib/utils/slug";
import {
	LIKED_SONGS_BOOTSTRAP_FETCH_SIZE,
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

/**
 * Gets all liked songs for an account.
 * Returns empty array if none found.
 */
export function getAll(
	accountId: string,
): Promise<Result<LikedSong[], DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("liked_song")
			.select("*")
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

	const { data, error } = await supabase.rpc("get_liked_songs_page", {
		p_account_id: accountId,
		p_cursor: cursorLikedAt,
		p_cursor_id: cursorId,
		p_limit: limit,
		p_filter: options.filter ?? "all",
		p_search: search,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	const rows = (data ?? []) as LikedSongPageRow[];
	const hasMore = rows.length > limit;
	const items = hasMore ? rows.slice(0, limit) : rows;
	const lastItem = items[items.length - 1];
	const nextCursor = hasMore
		? encodeCursor(lastItem.liked_at, lastItem.id)
		: null;

	return Result.ok({ items, nextCursor });
}

/**
 * Finds a liked song row by its deep-link slug.
 * Reuses the paginated RPC so the lookup returns the exact same row shape as the list.
 */
export async function getPageRowBySlug(
	accountId: string,
	slug: string,
): Promise<Result<LikedSongPageRow | null, DbError>> {
	let cursor: string | undefined;

	for (;;) {
		const pageResult = await getPageWithDetails(accountId, {
			cursor,
			filter: "all",
			limit: LIKED_SONGS_BOOTSTRAP_FETCH_SIZE,
		});

		if (Result.isError(pageResult)) {
			return Result.err(pageResult.error);
		}

		const matchingRow = pageResult.value.items.find((row) =>
			pageRowMatchesSlug(row, slug),
		);

		if (matchingRow) {
			return Result.ok(matchingRow);
		}

		if (pageResult.value.nextCursor === null) {
			return Result.ok(null);
		}

		cursor = pageResult.value.nextCursor;
	}
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
 * Gathers up to `LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS` older rows after a slug
 * match so the selection isn't the last loaded row. `afterMatch` is the
 * post-selection slice of the matching chunk; further chunks are fetched only
 * when it falls short. Returns the rows plus whether the library holds more past
 * the tail (drives the final page's `nextCursor`).
 */
async function collectTrailingRows(
	accountId: string,
	afterMatch: LikedSongPageRow[],
	chunkNextCursor: string | null,
): Promise<
	Result<{ trailing: LikedSongPageRow[]; hasMoreAfterLast: boolean }, DbError>
> {
	const trailing: LikedSongPageRow[] = [];
	let remaining = LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS;
	let chunk = afterMatch;
	let nextCursor = chunkNextCursor;

	for (;;) {
		const take = chunk.slice(0, remaining);
		trailing.push(...take);
		remaining -= take.length;

		// Filled before the chunk ran out: rows still follow the tail.
		if (take.length < chunk.length) {
			return Result.ok({ trailing, hasMoreAfterLast: true });
		}
		// Filled exactly at the boundary: defer to the chunk's cursor.
		if (remaining === 0) {
			return Result.ok({ trailing, hasMoreAfterLast: nextCursor !== null });
		}
		// Library ended before the buffer filled.
		if (nextCursor === null) {
			return Result.ok({ trailing, hasMoreAfterLast: false });
		}

		const pageResult = await getPageWithDetails(accountId, {
			cursor: nextCursor,
			filter: "all",
			limit: LIKED_SONGS_BOOTSTRAP_FETCH_SIZE,
		});
		if (Result.isError(pageResult)) {
			return Result.err(pageResult.error);
		}
		chunk = pageResult.value.items;
		nextCursor = pageResult.value.nextCursor;
	}
}

/**
 * Builds the deep-link bootstrap for a slug in a single newest-first walk:
 *
 * - Valid slug: returns the contiguous prefix from the newest liked song through
 *   the selected one, plus up to `LIKED_SONGS_BOOTSTRAP_TRAILING_ROWS` older rows
 *   so the selection isn't the last loaded row, rechunked to the client page
 *   size. The final page keeps a non-null cursor when older songs remain.
 * - Missing / bogus slug: returns `selectedRow: null` and only the canonical
 *   first page, byte-identical to a normal `limit = LIKED_SONGS_PAGE_SIZE`
 *   fetch, so the list still renders and the panel stays closed.
 *
 * This intentionally does the bootstrap in one walk. Without a database-level,
 * indexed slug lookup, a preflight existence guard would just scan once to find
 * the row (or prove it missing) and then force a second walk to build the
 * prefix, which is strictly worse for valid deep links.
 *
 * Phase 1 still walks the library page-by-page; for very deep deep-links or
 * bogus slugs this can be several round-trips. A dedicated SQL/RPC returning
 * the prefix in one shot is the documented Phase 2 optimization.
 */
export async function getBootstrapPagesBySlug(
	accountId: string,
	slug: string,
): Promise<Result<LikedSongsBootstrapPages, DbError>> {
	const flattened: LikedSongPageRow[] = [];
	let cursor: string | undefined;
	let firstPageRows: LikedSongPageRow[] | null = null;
	let firstPageHasMore = false;

	for (;;) {
		const pageResult = await getPageWithDetails(accountId, {
			cursor,
			filter: "all",
			limit: LIKED_SONGS_BOOTSTRAP_FETCH_SIZE,
		});

		if (Result.isError(pageResult)) {
			return Result.err(pageResult.error);
		}

		const { items, nextCursor } = pageResult.value;
		if (firstPageRows === null) {
			firstPageRows = items.slice(0, LIKED_SONGS_PAGE_SIZE);
			firstPageHasMore =
				items.length > LIKED_SONGS_PAGE_SIZE || nextCursor !== null;
		}
		const matchIndex = items.findIndex((row) => pageRowMatchesSlug(row, slug));

		if (matchIndex !== -1) {
			flattened.push(...items.slice(0, matchIndex + 1));
			const trailingResult = await collectTrailingRows(
				accountId,
				items.slice(matchIndex + 1),
				nextCursor,
			);
			if (Result.isError(trailingResult)) {
				return Result.err(trailingResult.error);
			}
			flattened.push(...trailingResult.value.trailing);
			return Result.ok({
				selectedRow: items[matchIndex],
				pages: chunkBootstrapRows(
					flattened,
					trailingResult.value.hasMoreAfterLast,
				),
			});
		}

		flattened.push(...items);

		if (nextCursor === null) {
			return Result.ok({
				selectedRow: null,
				pages: chunkBootstrapRows(firstPageRows ?? [], firstPageHasMore),
			});
		}

		cursor = nextCursor;
	}
}

/**
 * Gets aggregate stats for liked songs (total, analyzed, sorted, unsorted).
 * Single efficient query independent of pagination.
 */
export async function getStats(
	accountId: string,
): Promise<Result<LikedSongsStatsRow, DbError>> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase
		.rpc("get_liked_songs_stats", { p_account_id: accountId })
		.single();

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	return Result.ok(data);
}

/**
 * Gets liked songs that haven't been processed yet (no account_item_newness record).
 * These are songs waiting for user action (add to playlist, dismiss, etc.).
 */
export async function getPending(
	accountId: string,
): Promise<Result<LikedSong[], DbError>> {
	const supabase = createAdminSupabaseClient();

	// Get all liked song IDs for this account
	const likedResult = await fromSupabaseMany(
		supabase
			.from("liked_song")
			.select("*")
			.eq("account_id", accountId)
			.is("unliked_at", null),
	);

	if (Result.isError(likedResult)) {
		return likedResult;
	}

	const likedSongs = likedResult.value;
	if (likedSongs.length === 0) {
		return Result.ok<LikedSong[], DbError>([]);
	}

	// Get song IDs that have account_item_newness records (chunked to avoid URI-too-long)
	const songIds = likedSongs.map((ls: LikedSong) => ls.song_id);
	const CHUNK_SIZE = 50;
	const CHUNK_CONCURRENCY = 4;
	const chunks = chunkArray(songIds, CHUNK_SIZE);

	const statusResults = await mapWithConcurrency(
		chunks,
		CHUNK_CONCURRENCY,
		(chunk) =>
			fromSupabaseMany<{ item_id: string }>(
				supabase
					.from("account_item_newness")
					.select("item_id")
					.eq("account_id", accountId)
					.eq("item_type", "song")
					.in("item_id", chunk),
			),
	);

	const processedIds = new Set<string>();
	for (const statusResult of statusResults) {
		if (Result.isError(statusResult)) {
			return Result.err(statusResult.error);
		}

		for (const status of statusResult.value) {
			processedIds.add(status.item_id);
		}
	}
	const pending = likedSongs.filter(
		(ls: LikedSong) => !processedIds.has(ls.song_id),
	);

	return Result.ok(pending);
}

/**
 * Creates or updates liked songs for an account.
 * Uses (account_id, song_id) as the conflict target.
 * Returns all upserted liked songs.
 */
export function upsert(
	accountId: string,
	data: UpsertData[],
): Promise<Result<LikedSong[], DbError>> {
	if (data.length === 0) {
		return Promise.resolve(Result.ok<LikedSong[], DbError>([]));
	}
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany(
		supabase
			.from("liked_song")
			.upsert(
				data.map((ls) => ({
					account_id: accountId,
					song_id: ls.song_id,
					liked_at: ls.liked_at,
				})),
				{ onConflict: "account_id,song_id" },
			)
			.select(),
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
	return fromSupabaseMany(
		supabase
			.from("liked_song")
			.update({ unliked_at: new Date().toISOString() })
			.eq("account_id", accountId)
			.in("song_id", songIds)
			.select(),
	);
}
