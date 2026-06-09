#!/usr/bin/env bun
/**
 * Reproduce the worker's Genius lyrics lookup for a single song, with the
 * service's debug flag on. Uses getLyrics (no persistence) so it's read-only.
 *
 * Usage: DEBUG_LYRICS_SEARCH=true bun run scripts/debug-lyrics-lookup.ts "Artist" "Title"
 */
import { Result } from "better-result";
import { LyricsService } from "@/lib/domains/enrichment/lyrics/service";

const [artist, title] = process.argv.slice(2);
if (!artist || !title) {
	console.error('Usage: bun run scripts/debug-lyrics-lookup.ts "Artist" "Title"');
	process.exit(1);
}

const token = process.env.GENIUS_CLIENT_TOKEN;
if (!token) {
	console.error("GENIUS_CLIENT_TOKEN not set");
	process.exit(1);
}

const service = new LyricsService({ accessToken: token });
const result = await service.getLyrics(artist, title);

if (Result.isError(result)) {
	const err = result.error;
	console.log("FAILED");
	console.log("error class:", err.constructor.name);
	console.log("message:", err.message);
	for (const key of ["statusCode", "url", "artist", "song", "reason"]) {
		if (key in err)
			console.log(`${key}:`, (err as unknown as Record<string, unknown>)[key]);
	}
} else {
	const sections = result.value;
	console.log("SUCCESS");
	console.log("sections:", sections.length);
	console.log(
		"total lines:",
		sections.reduce((n, s) => n + s.lines.length, 0),
	);
	for (const s of sections.slice(0, 3)) {
		console.log(`-- [${s.type}]`, s.lines.slice(0, 2).map((l) => l.text));
	}
}
