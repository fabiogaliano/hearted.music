/**
 * Result wrappers for Supabase/Postgrest queries.
 */

import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { Result } from "better-result";
import type { z } from "zod";
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

/**
 * Wraps a Supabase RPC call and validates its shape against a Zod schema.
 * PostgREST/Supabase types RPC returns as `any`, so a column rename or
 * function signature change on the DB side would otherwise surface as a
 * silent runtime shape mismatch instead of a typed failure at the call site.
 *
 * `data ?? []` treats a null RPC result as an empty row set (matches
 * fromSupabaseMany) before validation runs.
 *
 * @example
 * const result = await fromSupabaseRpc(
 *   RowsSchema,
 *   supabase.rpc("read_match_review_item_song_suggestions", { ... })
 * );
 */
export async function fromSupabaseRpc<S extends z.ZodType>(
	schema: S,
	rpcPromise: PromiseLike<{
		data: unknown;
		error: { code: string; message: string; details?: string } | null;
	}>,
): Promise<Result<z.infer<S>, DbError>> {
	const { data, error } = await rpcPromise;

	if (error) {
		return Result.err(mapPostgrestError(error));
	}

	const parsed = schema.safeParse(data ?? []);
	if (!parsed.success) {
		return Result.err(
			new DatabaseError({
				code: "rpc_shape_mismatch",
				message: `RPC response did not match the expected shape: ${parsed.error.message}`,
			}),
		);
	}

	return Result.ok(parsed.data);
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
