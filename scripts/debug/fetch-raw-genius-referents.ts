#!/usr/bin/env bun
/**
 * Dumps the raw Genius referents API response for a song to a JSON file.
 * Usage: bun run scripts/debug/fetch-raw-genius-referents.ts "<artist>" "<song title>"
 *   e.g. bun run scripts/debug/fetch-raw-genius-referents.ts "Kendrick Lamar" "Money Trees"
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TOKEN = process.env.GENIUS_CLIENT_TOKEN ?? Bun.env.GENIUS_CLIENT_TOKEN;
if (!TOKEN) {
	console.error("GENIUS_CLIENT_TOKEN not set");
	process.exitCode = 1;
	process.exit();
}

const [artist = "Benson Boone", song = "Beautiful Things"] = process.argv.slice(2);

const BASE = "https://api.genius.com";
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

async function getJson<T>(path: string): Promise<T> {
	const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
	if (!res.ok) throw new Error(`Genius ${res.status}: ${path}`);
	return res.json() as Promise<T>;
}

// 1. Search for the song
const query = encodeURIComponent(`${song} ${artist}`);
const searchResponse = await getJson<{ response: { hits: { result: { id: number; title: string; primary_artist: { name: string } } }[] } }>(
	`/search?q=${query}`,
);

const hit = searchResponse.response.hits[0]?.result;
if (!hit) {
	console.error("Song not found in search results");
	process.exitCode = 1;
	process.exit();
}

console.log(`Found: ${hit.primary_artist.name} — ${hit.title} (id: ${hit.id})`);

// 2. Fetch referents pages (raw, no transformation)
const pages = await Promise.all(
	[1, 2, 3, 4].map((page) =>
		getJson(`/referents?song_id=${hit.id}&text_format=plain&per_page=50&page=${page}`),
	),
);

const output = {
	song: { id: hit.id, title: hit.title, artist: hit.primary_artist.name },
	pages,
};

const slug = `${artist}-${song}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const outDir = join(import.meta.dir, ".scratch");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `genius-referents-${slug}-raw.json`);
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Written to: ${outPath}`);
