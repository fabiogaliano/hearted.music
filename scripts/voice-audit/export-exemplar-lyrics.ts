#!/usr/bin/env bun
/**
 * Exports the stored lyrics + annotations for every voice-audit exemplar into
 * scripts/voice-audit/exemplars/lyrics/<key>.json.
 *
 * All exemplars already have a song_lyrics row in the local DB (source=genius),
 * so this reads straight from Postgres — no Genius round-trip. The on-disk shape
 * mirrors the original claudedocs/pink-pony-club-db-export.json envelope:
 *
 *   { song: { id, name, artists, album_name },
 *     lyrics: { source, document, content_hash, schema_version, has_annotations } }
 *
 *   bun run scripts/voice-audit/export-exemplar-lyrics.ts
 *
 * Matching is by spotify_id when the index carries a real 22-char Spotify ID,
 * otherwise by (name ILIKE title AND artist = ANY(artists)) for the slug entries.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const EXEMPLARS_DIR = join(dirname(fileURLToPath(import.meta.url)), "exemplars");
const LYRICS_DIR = join(EXEMPLARS_DIR, "lyrics");

interface IndexEntry {
	key: string;
	song: string;
	spotifyTrackId: string;
	file: string;
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

interface LyricsRow {
	id: string;
	name: string;
	artists: string[];
	album_name: string | null;
	source: string | null;
	document: unknown;
	content_hash: string | null;
	schema_version: number | null;
	has_annotations: boolean | null;
}

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

function parseSongLabel(label: string): { artist: string; title: string } {
	const [artist, title] = label.split(" — ");
	if (!artist || !title) {
		throw new Error(`Cannot parse "Artist — Title" from index label: "${label}"`);
	}
	return { artist: artist.trim(), title: title.trim() };
}

async function main() {
	const index = JSON.parse(
		readFileSync(join(EXEMPLARS_DIR, "index.json"), "utf-8"),
	) as { entries: IndexEntry[] };

	mkdirSync(LYRICS_DIR, { recursive: true });

	let ok = 0;
	const problems: string[] = [];

	for (const entry of index.entries) {
		const { artist, title } = parseSongLabel(entry.song);
		const byId = SPOTIFY_ID.test(entry.spotifyTrackId);

		const rows = byId
			? await sql<LyricsRow[]>`
					SELECT s.id, s.name, s.artists, s.album_name,
						sl.source, sl.document, sl.content_hash, sl.schema_version, sl.has_annotations
					FROM song s
					LEFT JOIN song_lyrics sl ON sl.song_id = s.id AND sl.source = 'genius'
					WHERE s.spotify_id = ${entry.spotifyTrackId}`
			: await sql<LyricsRow[]>`
					SELECT s.id, s.name, s.artists, s.album_name,
						sl.source, sl.document, sl.content_hash, sl.schema_version, sl.has_annotations
					FROM song s
					LEFT JOIN song_lyrics sl ON sl.song_id = s.id AND sl.source = 'genius'
					WHERE s.name ILIKE ${title} AND ${artist} = ANY(s.artists)`;

		if (rows.length === 0) {
			problems.push(`${entry.key}: no song row (${artist} — ${title})`);
			continue;
		}
		if (rows.length > 1) {
			problems.push(`${entry.key}: ${rows.length} song rows matched — ambiguous`);
			continue;
		}

		const row = rows[0];
		if (!row.source || row.document == null) {
			problems.push(`${entry.key}: song ${row.id} has no genius lyrics row`);
			continue;
		}

		const envelope = {
			song: {
				id: row.id,
				name: row.name,
				artists: row.artists,
				album_name: row.album_name,
			},
			lyrics: {
				source: row.source,
				document: row.document,
				content_hash: row.content_hash,
				schema_version: row.schema_version,
				has_annotations: row.has_annotations,
			},
		};

		const outPath = join(LYRICS_DIR, `${entry.key}.json`);
		writeFileSync(outPath, `${JSON.stringify(envelope, null, 2)}\n`);
		ok++;
		console.log(
			`exported  ${entry.key.padEnd(18)} ${row.id}  annot:${row.has_annotations}`,
		);
	}

	console.log(`\nDone. ${ok}/${index.entries.length} exemplars exported to lyrics/`);
	if (problems.length > 0) {
		console.log("Problems:");
		for (const p of problems) console.log(`  - ${p}`);
		process.exitCode = 1;
	}

	await sql.end();
}

main();
