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
 *
 * After the fetch_status migration (Decision 5), every fetch attempt writes a
 * row regardless of outcome. Sentinel values for non-lyrics rows:
 *   content_hash  = "no-content"  (stable; no document to hash)
 *   schema_version = 0            (reserved; 1 means a real lyrics document)
 *   source (unique key) = outcome source, or "not_found" for the not_found case
 *   fetch_source  = lrclib | genius | genius_page | null (not_found has no source)
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
import type { LyricsOutcome } from "./types/lyrics.types";
import type { TransformedLyricsBySection } from "./utils/lyrics-transformer";

export type SongLyrics = Tables<"song_lyrics">;

export const LYRICS_SCHEMA_VERSION = 1;

const AnnotationInfoSchema = z.object({
	text: z.string(),
	verified: z.boolean(),
	votes_total: z.number(),
	// The worker writes an absent role/state as `undefined`, which Postgres jsonb persists as
	// null, so the read path must accept null and normalize it back to undefined to match
	// AnnotationInfo. The vast majority of stored annotations carry pinnedRole: null — without
	// this the whole document fails to parse and the cache silently refetches from Genius.
	pinnedRole: z
		.string()
		.nullish()
		.transform((v) => v ?? undefined),
	state: z
		.string()
		.nullish()
		.transform((v) => v ?? undefined),
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

export function parseDocument(raw: Json): Result<LyricsDocument, DbError> {
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
	const result = await fromSupabaseMaybe<{ document: Json | null }>(
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
	// null row means no record at all; null document means instrumental/not_found row
	if (result.value === null || result.value.document === null) {
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
					fetch_status: "lyrics",
					fetch_source: source,
				},
				{ onConflict: "song_id,source" },
			)
			.select()
			.single(),
	);
}

// ─── Fetch-outcome persistence (Decision 5) ──────────────────────────────────

/**
 * Sentinel content_hash for non-lyrics rows (instrumental / not_found).
 * A real lyrics row uses a SHA-256 prefix; this string is unprefixed and
 * unambiguous, so it can never collide with a hashed document.
 */
const NO_CONTENT_HASH = "no-content";

/**
 * Sentinel schema_version for non-lyrics rows.
 * Version 0 is reserved; real lyrics documents start at version 1.
 */
const NO_CONTENT_SCHEMA_VERSION = 0;

/**
 * Maps a LyricsOutcome to the `source` value used as the UNIQUE key
 * in song_lyrics(song_id, source).
 *
 * - lyrics / instrumental rows use the provider name directly ("lrclib", "genius")
 * - genius_page is still the Genius provider → key is "genius"
 * - not_found has no provider → sentinel key "not_found"
 */
function outcomeUniqueKey(outcome: LyricsOutcome): string {
	if (outcome.kind === "not_found") return "not_found";
	if (outcome.kind === "instrumental" && outcome.source === "genius_page")
		return "genius";
	return outcome.source;
}

/**
 * A typed snapshot of a previously-attempted fetch, read back from the DB.
 * Distinct from `null`, which means the song was never attempted.
 */
export interface StoredFetchOutcome {
	fetchStatus: "lyrics" | "instrumental" | "not_found";
	fetchSource: string | null;
}

/**
 * Writes (or overwrites) a song_lyrics row representing the outcome of one
 * fetch attempt.  Covers all three LyricsOutcome kinds:
 *
 *   lyrics        – stores the full document + metadata; requires `sections`
 *                   when the caller has already parsed rich Genius sections;
 *                   falls back to a single-section plain-text document for
 *                   plain-text providers (e.g. LRCLIB).
 *   instrumental  – stores fetch_status + fetch_source with no document.
 *   not_found     – stores fetch_status with no document or source.
 *
 * The unique key is (song_id, source) — see outcomeUniqueKey for the mapping.
 */
export async function upsertFetchOutcome(
	songId: string,
	outcome: LyricsOutcome,
	sections?: TransformedLyricsBySection[],
): Promise<Result<SongLyrics, DbError>> {
	const supabase = createAdminSupabaseClient();
	const uniqueSource = outcomeUniqueKey(outcome);

	if (outcome.kind === "lyrics") {
		const resolvedSections: TransformedLyricsBySection[] = sections ?? [
			// Plain-text providers (e.g. LRCLIB) deliver a single block of text.
			// Wrap it as a single anonymous section so the document schema is satisfied.
			{
				type: "lyrics",
				lines: outcome.text
					.split("\n")
					.map((text, index) => ({ id: index + 1, text })),
			},
		];

		const document: LyricsDocument = {
			schemaVersion: LYRICS_SCHEMA_VERSION,
			source: outcome.source,
			sections: resolvedSections,
		};

		const contentHash = await hashDocument(document);

		return fromSupabaseSingle(
			supabase
				.from("song_lyrics")
				.upsert(
					{
						song_id: songId,
						source: uniqueSource,
						document: toDocumentJson(document),
						content_hash: contentHash,
						has_annotations: hasAnyAnnotations(resolvedSections),
						schema_version: LYRICS_SCHEMA_VERSION,
						fetch_status: "lyrics",
						fetch_source: outcome.source,
					},
					{ onConflict: "song_id,source" },
				)
				.select()
				.single(),
		);
	}

	// instrumental / not_found: no document, sentinel hash + version
	return fromSupabaseSingle(
		supabase
			.from("song_lyrics")
			.upsert(
				{
					song_id: songId,
					source: uniqueSource,
					document: null,
					content_hash: NO_CONTENT_HASH,
					has_annotations: false,
					schema_version: NO_CONTENT_SCHEMA_VERSION,
					fetch_status: outcome.kind,
					fetch_source: outcome.kind === "instrumental" ? outcome.source : null,
				},
				{ onConflict: "song_id,source" },
			)
			.select()
			.single(),
	);
}

/**
 * Returns the most-recent stored fetch outcome for a song, or null when the
 * song has never been attempted.
 *
 * Callers MUST distinguish null (no attempt) from { fetchStatus: "not_found" }
 * (all providers returned nothing).  This prevents re-treating a confirmed
 * not_found as an unattempted song.
 */
export async function getSongFetchOutcome(
	songId: string,
): Promise<Result<StoredFetchOutcome | null, DbError>> {
	const supabase = createAdminSupabaseClient();

	const result = await fromSupabaseMaybe<{
		fetch_status: string;
		fetch_source: string | null;
	}>(
		supabase
			.from("song_lyrics")
			.select("fetch_status, fetch_source")
			.eq("song_id", songId)
			.order("updated_at", { ascending: false })
			.limit(1)
			.single(),
	);

	if (Result.isError(result)) return Result.err(result.error);
	if (result.value === null) return Result.ok(null);

	const { fetch_status, fetch_source } = result.value;

	const parseResult = FetchStatusSchema.safeParse(fetch_status);
	if (!parseResult.success) {
		return Result.err(
			new DatabaseError({
				code: "invalid_fetch_status",
				message: `Unrecognised fetch_status value: ${fetch_status}`,
			}),
		);
	}

	return Result.ok({
		fetchStatus: parseResult.data,
		fetchSource: fetch_source,
	});
}

const FetchStatusSchema = z.enum(["lyrics", "instrumental", "not_found"]);
