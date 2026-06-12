#!/usr/bin/env bun
/**
 * Backfill lyrics for songs via the Genius LyricsService.
 *
 * Default scope is songs that already have an analysis (the set with a
 * generated compound_mood worth validating against lyrics). Pass --all to
 * cover every song in the library. fetchAndStoreOutcome is idempotent and
 * upserts on (song_id, source), so re-runs skip already-fetched songs.
 *
 *   bun run scripts/fetch-lyrics.ts          # analyzed songs only
 *   bun run scripts/fetch-lyrics.ts --all    # entire library
 */

import { Result } from "better-result";
import postgres from "postgres";
import { createLyricsService } from "@/lib/domains/enrichment/lyrics/service";

const ALL = process.argv.includes("--all");

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

interface Target {
	song_id: string;
	name: string;
	artist: string;
}

async function main() {
	const serviceResult = createLyricsService();
	if (Result.isError(serviceResult)) {
		console.error(`Cannot start: ${serviceResult.error.message}`);
		process.exitCode = 1;
		return;
	}
	const service = serviceResult.value;

	const targets = ALL
		? await sql<Target[]>`
				SELECT s.id AS song_id, s.name, s.artists[1] AS artist
				FROM song s
				WHERE s.artists[1] IS NOT NULL
				ORDER BY s.name`
		: await sql<Target[]>`
				SELECT DISTINCT s.id AS song_id, s.name, s.artists[1] AS artist
				FROM song s
				JOIN song_analysis sa ON sa.song_id = s.id
				WHERE s.artists[1] IS NOT NULL
				ORDER BY s.name`;

	console.log(
		`Fetching lyrics for ${targets.length} ${ALL ? "library" : "analyzed"} songs...`,
	);

	let ok = 0;
	let notFound = 0;
	let failed = 0;
	const misses: string[] = [];

	const results = await Promise.allSettled(
		targets.map(async (t) => {
			const r = await service.fetchAndStoreOutcome({
				songId: t.song_id,
				artist: t.artist,
				song: t.name,
			});
			return { t, r };
		}),
	);

	for (const settled of results) {
		if (settled.status === "rejected") {
			failed++;
			continue;
		}
		const { t, r } = settled.value;
		if (Result.isOk(r)) {
			if (r.value.kind === "not_found") {
				notFound++;
				misses.push(`${t.artist} - ${t.name}`);
			} else {
				ok++;
			}
		} else {
			const kind = r.error.constructor.name;
			failed++;
			misses.push(`${t.artist} - ${t.name} [${kind}]`);
		}
	}

	console.log(`\nDone. stored/cached: ${ok}  not-found: ${notFound}  failed: ${failed}`);
	if (misses.length > 0) {
		console.log("Misses:");
		for (const m of misses) console.log(`  - ${m}`);
	}

	await sql.end();
}

main();
