/**
 * Generates an idempotent SQL transaction to prefill the 20 landing/demo songs
 * into prod: `song` rows (ON CONFLICT DO NOTHING) + curated `song_analysis`
 * rows lifted verbatim from each `public/landing-songs/<id>.json` `read` blob.
 *
 * The read blob is already in the SongRead shape the walkthrough panel parses
 * (SongReadSchema), so it is stored as-is. JSONB literals are dollar-quoted to
 * sidestep apostrophes/quotes in lyrics.
 *
 * Usage: bun scripts/gen-demo-songs-sql.ts > /tmp/demo-songs.sql
 */

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const DIR = resolve(import.meta.dirname, "../public/landing-songs");

interface ManifestEntry {
	spotifyTrackId: string;
	name: string;
	artist: string;
	spotifyArtistId: string;
	album?: string | null;
	albumArtUrl?: string | null;
	genres?: string[];
}

const manifest = JSON.parse(readFileSync(join(DIR, "index.json"), "utf-8")) as {
	songs: ManifestEntry[];
};

// Dollar-quote tag chosen so it cannot collide with JSON content.
const TAG = "demosr";

function pgTextArray(items: string[]): string {
	// Build a Postgres text[] literal via ARRAY[...] with dollar-quoted elements.
	if (items.length === 0) return "ARRAY[]::text[]";
	const elems = items.map((s) => `$${TAG}$${s}$${TAG}$`).join(", ");
	return `ARRAY[${elems}]::text[]`;
}

const lines: string[] = [];
lines.push("BEGIN;");
lines.push("");

for (const e of manifest.songs) {
	const detail = JSON.parse(
		readFileSync(join(DIR, `${e.spotifyTrackId}.json`), "utf-8"),
	) as { read?: unknown };

	const artists = pgTextArray([e.artist]);
	const artistIds = pgTextArray([e.spotifyArtistId]);
	const genres = pgTextArray(e.genres ?? []);
	const album = e.album
		? `$${TAG}$${e.album}$${TAG}$`
		: "NULL";
	const img = e.albumArtUrl
		? `$${TAG}$${e.albumArtUrl}$${TAG}$`
		: "NULL";

	lines.push(`-- ${e.artist} — ${e.name}`);
	lines.push(
		`INSERT INTO public.song (spotify_id, name, artists, artist_ids, genres, album_name, image_url, created_at, updated_at)\n` +
			`VALUES ($${TAG}$${e.spotifyTrackId}$${TAG}$, $${TAG}$${e.name}$${TAG}$, ${artists}, ${artistIds}, ${genres}, ${album}, ${img}, now(), now())\n` +
			`ON CONFLICT (spotify_id) DO NOTHING;`,
	);

	if (detail.read) {
		const readJson = JSON.stringify(detail.read);
		// Insert curated analysis only if this song has no curated row yet.
		lines.push(
			`INSERT INTO public.song_analysis (song_id, analysis, model, prompt_version, created_at, updated_at)\n` +
				`SELECT s.id, $${TAG}$${readJson}$${TAG}$::jsonb, 'curated:landing-v17', 'curated', now(), now()\n` +
				`FROM public.song s\n` +
				`WHERE s.spotify_id = $${TAG}$${e.spotifyTrackId}$${TAG}$\n` +
				`  AND NOT EXISTS (\n` +
				`    SELECT 1 FROM public.song_analysis a\n` +
				`    WHERE a.song_id = s.id AND a.model = 'curated:landing-v17'\n` +
				`  );`,
		);
	}
	lines.push("");
}

lines.push("COMMIT;");
process.stdout.write(lines.join("\n"));
