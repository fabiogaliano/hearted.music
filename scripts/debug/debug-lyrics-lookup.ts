#!/usr/bin/env bun
/**
 * Reproduce the worker's lyric lookup for a single song, read-only. With the
 * Genius scrape removed, LRCLIB is the canonical lyric source, so this fetches
 * the LRCLIB plain text by (artist, title) — no persistence, no annotations.
 *
 * Usage: bun run scripts/debug/debug-lyrics-lookup.ts "Artist" "Title"
 */
import { fetchLrclibPlainLyrics } from "../lib/lrclib-plain-lyrics";

const [artist, title] = process.argv.slice(2);
if (!artist || !title) {
	console.error('Usage: bun run scripts/debug/debug-lyrics-lookup.ts "Artist" "Title"');
	process.exit(1);
}

const lyrics = await fetchLrclibPlainLyrics(artist, title);

if (!lyrics) {
	console.log("MISS (no LRCLIB lyrics for this artist/title)");
} else {
	const lines = lyrics.split("\n");
	console.log("SUCCESS");
	console.log("lines:", lines.length);
	console.log("preview:", lines.slice(0, 6));
}
