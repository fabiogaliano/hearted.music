/**
 * Lyrics persistence operations.
 *
 * Uses service role client to bypass RLS since lyrics are written by the
 * enrichment worker, not end users. Returns Result<T, DbError>.
 *
 * Lyrics are stored as a versioned envelope per (song, source). The `source`
 * column is the pluggable axis: a future provider can coexist with Genius
 * rows without a schema change. Annotations live inline on each line, matching
 * the shape the Genius transformer already produces.
 */

import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Json, Tables } from "@/lib/data/database.types";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import type { TransformedLyricsBySection } from "./utils/lyrics-transformer";

export type SongLyrics = Tables<"song_lyrics">;

export const LYRICS_SCHEMA_VERSION = 1;

const AnnotationInfoSchema = z.object({
	text: z.string(),
	verified: z.boolean(),
	votes_total: z.number(),
	pinnedRole: z.string().optional(),
	state: z.string().optional(),
	geniusAnnotationId: z.number().optional(),
});

const TransformedLineSchema = z.object({
	id: z.number(),
	text: z.string(),
	range: z
		.object({
			start: z.number(),
			end: z.number(),
		})
		.optional(),
	annotations: z.array(AnnotationInfoSchema).optional(),
});

const TransformedLyricsBySectionSchema = z.object({
	type: z.string(),
	lines: z.array(TransformedLineSchema),
});

const LyricsDocumentSchema = z.object({
	schemaVersion: z.literal(LYRICS_SCHEMA_VERSION),
	source: z.string(),
	sections: z.array(TransformedLyricsBySectionSchema),
});

/** Versioned envelope stored in song_lyrics.document. */
export interface LyricsDocument {
	schemaVersion: number;
	source: string;
	sections: TransformedLyricsBySection[];
}

function hasAnyAnnotations(sections: TransformedLyricsBySection[]): boolean {
	return sections.some((section) =>
		section.lines.some((line) => (line.annotations?.length ?? 0) > 0),
	);
}

function toDocumentJson(document: LyricsDocument): Json {
	return {
		schemaVersion: document.schemaVersion,
		source: document.source,
		sections: document.sections.map((section) => ({
			type: section.type,
			lines: section.lines.map((line) => ({
				id: line.id,
				text: line.text,
				range: line.range
					? {
							start: line.range.start,
							end: line.range.end,
						}
					: undefined,
				annotations: line.annotations?.map((annotation) => ({
					text: annotation.text,
					verified: annotation.verified,
					votes_total: annotation.votes_total,
					pinnedRole: annotation.pinnedRole,
					state: annotation.state,
					geniusAnnotationId: annotation.geniusAnnotationId,
				})),
			})),
		})),
	};
}

function parseDocument(raw: Json): Result<LyricsDocument, DbError> {
	const parsed = LyricsDocumentSchema.safeParse(raw);
	if (!parsed.success) {
		return Result.err(
			new DatabaseError({
				code: "invalid_song_lyrics_document",
				message:
					"song_lyrics.document has an unsupported shape or schema version",
			}),
		);
	}

	return Result.ok(parsed.data);
}

/**
 * SHA-256 of the document for change detection / dedupe.
 * Web Crypto keeps this Edge-compatible, matching the embeddings hashing.
 * Prefixed with the schema version so a format change invalidates old hashes.
 */
async function hashDocument(document: LyricsDocument): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(JSON.stringify(document));
	const buffer = await crypto.subtle.digest("SHA-256", data);
	const hex = Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return `ly_v${LYRICS_SCHEMA_VERSION}_${hex.slice(0, 16)}`;
}

export async function getSongLyricsDocument(
	songId: string,
	source = "genius",
): Promise<Result<LyricsDocument | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const result = await fromSupabaseMaybe<{ document: Json }>(
		supabase
			.from("song_lyrics")
			.select("document")
			.eq("song_id", songId)
			.eq("source", source)
			.single(),
	);
	if (Result.isError(result)) {
		return Result.err(result.error);
	}
	if (result.value === null) {
		return Result.ok(null);
	}

	return parseDocument(result.value.document);
}

/**
 * Upserts the lyrics document for a song from a given source.
 * Conflict target is (song_id, source): re-fetching the same source overwrites.
 */
export async function upsertSongLyrics(
	songId: string,
	sections: TransformedLyricsBySection[],
	source = "genius",
): Promise<Result<SongLyrics, DbError>> {
	const document: LyricsDocument = {
		schemaVersion: LYRICS_SCHEMA_VERSION,
		source,
		sections,
	};

	const contentHash = await hashDocument(document);
	const supabase = createAdminSupabaseClient();

	return fromSupabaseSingle(
		supabase
			.from("song_lyrics")
			.upsert(
				{
					song_id: songId,
					source,
					document: toDocumentJson(document),
					content_hash: contentHash,
					has_annotations: hasAnyAnnotations(sections),
					schema_version: LYRICS_SCHEMA_VERSION,
				},
				{ onConflict: "song_id,source" },
			)
			.select()
			.single(),
	);
}
