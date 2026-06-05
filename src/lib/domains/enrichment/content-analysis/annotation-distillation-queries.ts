/**
 * Persistence for the annotation-distillation cache.
 *
 * Service-role client (worker-written, deny-all RLS). Keyed by
 * (content_hash, distiller_version): the same annotation text distilled under the
 * same distiller is computed once and reused across every song that contains it.
 */

import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { DbError } from "@/lib/shared/errors/database";
import { fromSupabaseMany } from "@/lib/shared/utils/result-wrappers/supabase";

export interface AnnotationDistillationRow {
	content_hash: string;
	distiller_version: string;
	raw_text: string;
	distilled_text: string;
	model: string;
}

export interface CachedDistillation {
	content_hash: string;
	distilled_text: string;
}

/**
 * Fetches cached distillations for the given content hashes under one distiller version.
 * Returns an empty array (not an error) when nothing is asked for or nothing is cached.
 */
export async function getAnnotationDistillations(
	contentHashes: string[],
	distillerVersion: string,
): Promise<Result<CachedDistillation[], DbError>> {
	if (contentHashes.length === 0) {
		return Result.ok([]);
	}
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMany<CachedDistillation>(
		supabase
			.from("annotation_distillation")
			.select("content_hash, distilled_text")
			.eq("distiller_version", distillerVersion)
			.in("content_hash", contentHashes),
	);
}

/**
 * Upserts freshly computed distillations. Conflict target is the full key, so a
 * concurrent worker writing the same annotation just overwrites identically.
 */
export async function upsertAnnotationDistillations(
	rows: AnnotationDistillationRow[],
): Promise<Result<null, DbError>> {
	if (rows.length === 0) {
		return Result.ok(null);
	}
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMany<{ content_hash: string }>(
		supabase
			.from("annotation_distillation")
			.upsert(rows, { onConflict: "content_hash,distiller_version" })
			.select("content_hash"),
	);
	if (Result.isError(result)) {
		return Result.err(result.error);
	}
	return Result.ok(null);
}
