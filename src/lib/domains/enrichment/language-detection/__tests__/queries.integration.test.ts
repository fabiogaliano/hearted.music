import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Database, Json } from "@/lib/data/database.types";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DATABASE_URL =
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const IS_LOCAL =
	SUPABASE_URL.startsWith("http://127.0.0.1") &&
	SUPABASE_SERVICE_ROLE_KEY.length > 0;

const supabase = IS_LOCAL
	? createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
			auth: { autoRefreshToken: false, persistSession: false },
		})
	: null;
const sql = IS_LOCAL ? postgres(DATABASE_URL, { max: 1 }) : null;

const createdSongIds: string[] = [];
const HERE = dirname(fileURLToPath(import.meta.url));
const LANGUAGE_MIGRATION = resolve(
	HERE,
	"../../../../../../supabase/migrations/20260619200000_add_song_language.sql",
);

function lyricsDocument(source: string, text: string): Json {
	return {
		schemaVersion: 1,
		source,
		sections: [
			{
				type: "verse",
				lines: [{ id: 1, text }],
			},
		],
	};
}

async function insertSong(songId: string): Promise<void> {
	if (!supabase) throw new Error("supabase client not initialised");
	createdSongIds.push(songId);
	await supabase
		.from("song")
		.insert({
			id: songId,
			spotify_id: `sp-${songId}`,
			name: `Song ${songId}`,
			artists: ["Test Artist"],
			artist_ids: ["artist-test"],
			genres: [],
		})
		.throwOnError();
}

async function insertLyricsRow(input: {
	songId: string;
	source: string;
	fetchSource: string;
	document: Json;
	updatedAt: string;
	createdAt: string;
}): Promise<void> {
	if (!supabase) throw new Error("supabase client not initialised");
	await supabase
		.from("song_lyrics")
		.insert({
			song_id: input.songId,
			source: input.source,
			fetch_source: input.fetchSource,
			fetch_status: "lyrics",
			document: input.document,
			content_hash: `hash-${input.source}-${input.updatedAt}`,
			schema_version: 1,
			has_annotations: false,
			created_at: input.createdAt,
			updated_at: input.updatedAt,
		})
		.throwOnError();
}

async function selectSongsNeedingLanguageDetection(songIds: string[]) {
	if (!supabase) throw new Error("supabase client not initialised");
	const { data, error } = await supabase.rpc(
		"select_songs_needing_language_detection",
		{ p_song_ids: songIds },
	);
	if (error) throw error;
	return data ?? [];
}

beforeAll(async () => {
	if (!sql) return;
	await sql.unsafe(readFileSync(LANGUAGE_MIGRATION, "utf-8"));
});

afterAll(async () => {
	if (!sql) return;
	await sql.end();
});

afterEach(async () => {
	if (!supabase || createdSongIds.length === 0) return;
	const ids = [...createdSongIds];
	createdSongIds.length = 0;
	await supabase.from("song").delete().in("id", ids).throwOnError();
});

describe.skipIf(!IS_LOCAL)("select_songs_needing_language_detection", () => {
	it("returns the latest lyric-bearing row when multiple sources exist", async () => {
		if (!supabase) throw new Error("supabase client not initialised");
		const songId = crypto.randomUUID();
		await insertSong(songId);

		await insertLyricsRow({
			songId,
			source: "lrclib",
			fetchSource: "lrclib",
			document: lyricsDocument("lrclib", "older lyrics line"),
			createdAt: "2026-06-19T10:00:00Z",
			updatedAt: "2026-06-19T10:00:00Z",
		});
		await insertLyricsRow({
			songId,
			source: "genius",
			fetchSource: "genius",
			document: lyricsDocument("genius", "newer lyrics line"),
			createdAt: "2026-06-19T11:00:00Z",
			updatedAt: "2026-06-19T11:00:00Z",
		});

		const rows = await selectSongsNeedingLanguageDetection([songId]);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			song_id: songId,
			lyrics_text: "newer lyrics line",
		});
	});

	it("falls back to the latest row with real text when a newer document is malformed", async () => {
		if (!supabase) throw new Error("supabase client not initialised");
		const songId = crypto.randomUUID();
		await insertSong(songId);

		await insertLyricsRow({
			songId,
			source: "lrclib",
			fetchSource: "lrclib",
			document: lyricsDocument("lrclib", "stable lyrics line"),
			createdAt: "2026-06-19T10:00:00Z",
			updatedAt: "2026-06-19T10:00:00Z",
		});
		await insertLyricsRow({
			songId,
			source: "genius",
			fetchSource: "genius",
			document: { schemaVersion: 1, source: "genius" },
			createdAt: "2026-06-19T11:00:00Z",
			updatedAt: "2026-06-19T11:00:00Z",
		});

		const rows = await selectSongsNeedingLanguageDetection([songId]);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			song_id: songId,
			lyrics_text: "stable lyrics line",
		});
	});
});
