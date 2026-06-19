#!/usr/bin/env bun
/**
 * Backfill song.language for the existing corpus — the songs that already had
 * lyrics before in-pipeline detection existed. Going forward the enrichment
 * pipeline detects language right after it stores a song's lyrics; this script
 * is the one-time catch-up (same role as fetch-lyrics.ts for lyrics).
 *
 * Idempotent: only songs with lyrics and a null language_checked_at are selected,
 * and apply_song_language stamps checked_at on every row, so re-runs are no-ops.
 *
 *   bun run scripts/maintenance/detect-language.ts          # local DB
 *   DATABASE_URL=<prod-dsn> bun run scripts/maintenance/detect-language.ts
 */
import postgres from "postgres";
import { detectLanguage } from "@/lib/domains/enrichment/language-detection/detector";

const DSN = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const BATCH = 200;

const sql = postgres(DSN);

interface Candidate {
	song_id: string;
	lyrics_text: string | null;
}

async function main() {
	const candidates = await sql<Candidate[]>`
		WITH lyric_candidates AS (
			SELECT sl.song_id,
				sl.updated_at,
				sl.created_at,
				sl.id,
				(
					SELECT string_agg(line ->> 'text', E'\n')
					FROM jsonb_array_elements(coalesce(sl.document -> 'sections', '[]'::jsonb)) AS sec
					CROSS JOIN jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) AS line
					WHERE line ->> 'text' IS NOT NULL
				) AS lyrics_text
			FROM song_lyrics sl
			JOIN song s ON s.id = sl.song_id
			WHERE sl.fetch_status = 'lyrics'
				AND sl.document IS NOT NULL
				AND s.language_checked_at IS NULL
		)
		SELECT DISTINCT ON (song_id)
			song_id,
			lyrics_text
		FROM lyric_candidates
		WHERE lyrics_text IS NOT NULL
		ORDER BY song_id, updated_at DESC, created_at DESC, id DESC`;

	console.log(`Detecting language for ${candidates.length} songs...`);

	let detected = 0;
	let bilingual = 0;
	let written = 0;
	const distribution = new Map<string, number>();

	for (let i = 0; i < candidates.length; i += BATCH) {
		const slice = candidates.slice(i, i + BATCH);
		const payload = [];
		for (const c of slice) {
			const r = await detectLanguage(c.lyrics_text ?? "");
			if (r.language) {
				detected++;
				distribution.set(r.language, (distribution.get(r.language) ?? 0) + 1);
			}
			if (r.secondary) bilingual++;
			payload.push({
				song_id: c.song_id,
				language: r.language,
				language_confidence: r.language ? r.confidence : null,
				language_secondary: r.secondary,
			});
		}
		const [{ n }] = await sql<{ n: number }[]>`SELECT apply_song_language(${sql.json(payload)}) AS n`;
		written += Number(n);
		console.log(`  ${Math.min(i + BATCH, candidates.length)}/${candidates.length} (written so far: ${written})`);
	}

	const top = [...distribution.entries()].sort((a, b) => b[1] - a[1]);
	console.log(`\nDone. detected: ${detected}  bilingual: ${bilingual}  rows-written: ${written}`);
	console.log("Languages:", top.map(([l, n]) => `${l}:${n}`).join("  "));

	await sql.end();
}

main();
