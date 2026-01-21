/**
 * Result wrappers for Supabase/Postgrest queries.
 */

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { Result } from "better-result";
import {
	ConstraintError,
	DatabaseError,
	type DbError,
	NotFoundError,
	RLSError,
} from "@/lib/shared/errors/database";

/**
 * Wraps a Supabase query that returns a single row.
 *
 * @example
 * const result = await fromSupabaseSingle(
 *   supabase.from("account").select("*").eq("id", id).single()
 * );
 */
export async function fromSupabaseSingle<T>(
	query: PromiseLike<PostgrestSingleResponse<T>>,
): Promise<Result<T, DbError>> {
	const { data, error } = await query;

	if (error) {
		return Result.err(mapPostgrestError(error));
	}

	return Result.ok(data);
}

/**
 * Wraps a Supabase query that returns multiple rows.
 * Returns empty array if no rows found (not an error).
 *
 * @example
 * const result = await fromSupabaseMany(
 *   supabase.from("song").select("*").in("id", ids)
 * );
 */
export async function fromSupabaseMany<T>(
	query: PromiseLike<{
		data: T[] | null;
		error: { code: string; message: string } | null;
	}>,
): Promise<Result<T[], DbError>> {
	const { data, error } = await query;

	if (error) {
		return Result.err(mapPostgrestError(error));
	}

	return Result.ok(data ?? []);
}

/**
 * Wraps a Supabase query that may or may not find a row.
 * Returns null for not-found instead of an error.
 *
 * @example
 * const result = await fromSupabaseMaybe(
 *   supabase.from("account").select("*").eq("spotify_id", spotifyId).single()
 * );
 */
export async function fromSupabaseMaybe<T>(
	query: PromiseLike<PostgrestSingleResponse<T>>,
): Promise<Result<T | null, DbError>> {
	const { data, error } = await query;

	if (error) {
		if (error.code === "PGRST116") {
			return Result.ok(null);
		}
		return Result.err(mapPostgrestError(error));
	}

	return Result.ok(data);
}

function mapPostgrestError(error: {
	code: string;
	message: string;
	details?: string;
}): DbError {
	switch (error.code) {
		case "PGRST116":
			return new NotFoundError("record");

		case "23505":
			return new ConstraintError("unique", error.details ?? error.message);

		case "23503":
			return new ConstraintError("foreign_key", error.details ?? error.message);

		case "23514":
			return new ConstraintError("check", error.details ?? error.message);

		case "42501":
			return new RLSError("select", "unknown");

		default:
			return new DatabaseError({ code: error.code, message: error.message });
	}
}
