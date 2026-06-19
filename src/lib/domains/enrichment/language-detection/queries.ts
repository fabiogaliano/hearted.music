/**
 * DB read/write for lyric-language detection. Both sides go through scoped RPCs
 * (same pattern as vocal-gender / release-year) so a Phase-1 batch never
 * full-scans the catalog and the write is a single set-based statement.
 */
import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json } from "@/lib/data/database.types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";

export interface SongLyricsText {
	songId: string;
	lyricsText: string;
}

export interface LanguageResolution {
	song_id: string;
	language: string | null;
	language_confidence: number | null;
	language_secondary: string | null;
}

/**
 * Of the given songs, returns flattened lyric text for those that have real
 * lyrics and haven't been language-checked yet. Already-checked songs are
 * filtered out in SQL, so calling this on every batch is a steady-state no-op.
 */
export async function getSongsNeedingLanguageDetection(
	songIds: string[],
): Promise<Result<SongLyricsText[], DbError>> {
	if (songIds.length === 0) return Result.ok([]);

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc(
		"select_songs_needing_language_detection",
		{ p_song_ids: songIds },
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(
		(data ?? [])
			.filter(
				(row): row is { song_id: string; lyrics_text: string } =>
					row.lyrics_text != null,
			)
			.map((row) => ({ songId: row.song_id, lyricsText: row.lyrics_text })),
	);
}

/**
 * Bulk-applies detection results via apply_song_language. Stamps
 * language_checked_at on every matched row regardless of outcome. Returns the
 * number of rows touched.
 */
export async function applyLanguageResolution(
	rows: LanguageResolution[],
): Promise<Result<number, DbError>> {
	if (rows.length === 0) return Result.ok(0);

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase.rpc("apply_song_language", {
		p_rows: rows as unknown as Json,
	});

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}
	return Result.ok(Number(data) || 0);
}
