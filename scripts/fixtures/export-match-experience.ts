#!/usr/bin/env bun
/**
 * Builds a self-contained fixture for the "Match / Full Experience" Ladle story.
 *
 * Everything here is REAL data pulled from the local Supabase DB — songs,
 * playlists (covers, descriptions), and real per-playlist track membership. The
 * ONLY fabricated part is which song is matched to which playlist and the match
 * score, since the local `match_result` table is empty. Pairings are seeded
 * deterministically so the story is stable across rebuilds.
 *
 * Run: bun run scripts/fixtures/export-match-experience.ts
 *      bunx biome format --write src/stories/fixtures/match-experience.json
 * (Biome collapses short arrays that JSON.stringify expands, so format after.)
 * Output: src/stories/fixtures/match-experience.json
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const OUT = join(
	dirname(fileURLToPath(import.meta.url)),
	"../../src/stories/fixtures/match-experience.json",
);

// The five real playlists that actually have track rows + covers — the ones
// worth previewing, since the hover card's whole point is the track list.
const PLAYLIST_IDS = [
	"522d1368-56e5-421a-978a-288529029829", // Dubolt Mix (25)
	"925437f5-75cd-4830-ae17-2ec02df0031a", // Super Bock Super Rock 2021 (14)
	"bd39e303-0a0d-48b6-aabb-5624b1b0f63c", // main character energy!!1!! (6)
	"398a4b64-93d8-4ff4-80f9-98d6021e3336", // house? (6)
	"f8516bc7-44da-43e8-adde-07d11fef5613", // yilkes! (1)
];

const SONG_LIMIT = 8;
const MATCHES_PER_SONG = 4;

// Stable pseudo-score in [0.52, 0.94] from a song/playlist pair, so the faked
// rankings don't reshuffle between rebuilds.
function fakeScore(songId: string, playlistId: string): number {
	const seed = `${songId}:${playlistId}`;
	let hash = 0;
	for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
	return Math.round((0.52 + (hash % 43) / 100) * 1000) / 1000;
}

const sql = postgres("postgresql://postgres:postgres@127.0.0.1:54322/postgres");

try {
	const playlists = await sql`
		SELECT id, name, description, match_intent, image_url, song_count, spotify_id
		FROM playlist
		WHERE id IN ${sql(PLAYLIST_IDS)}
	`;

	const trackRows = await sql`
		SELECT ps.playlist_id, ps.position,
		       s.id AS song_id, s.name, s.artists, s.album_name, s.image_url
		FROM playlist_song ps
		JOIN song s ON s.id = ps.song_id
		WHERE ps.playlist_id IN ${sql(PLAYLIST_IDS)}
		ORDER BY ps.playlist_id, ps.position, ps.id
	`;

	// Real songs to walk through — liked songs with art + album, newest first.
	const songs = await sql`
		SELECT s.id, s.spotify_id, s.name, s.artists, s.album_name, s.image_url, s.genres
		FROM liked_song ls
		JOIN song s ON s.id = ls.song_id
		WHERE s.image_url IS NOT NULL AND s.album_name IS NOT NULL
		ORDER BY ls.liked_at DESC NULLS LAST
		LIMIT ${SONG_LIMIT}
	`;

	const playlistById = new Map(playlists.map((p) => [p.id, p]));

	// Real track membership, keyed by playlist id, in the server PlaylistTrack shape
	// the infinite query caches.
	const playlistTracks: Record<string, unknown[]> = {};
	for (const id of PLAYLIST_IDS) playlistTracks[id] = [];
	for (const t of trackRows) {
		playlistTracks[t.playlist_id]?.push({
			position: t.position,
			songId: t.song_id,
			name: t.name,
			artists: t.artists ?? [],
			albumName: t.album_name,
			imageUrl: t.image_url,
		});
	}

	// Fabricated pairings: rank all playlists per song by the stable fake score,
	// keep the top N. Real playlist metadata; only the score/pairing is invented.
	const matchesBySong: Record<string, unknown[]> = {};
	for (const song of songs) {
		matchesBySong[song.id] = PLAYLIST_IDS.map((pid) => {
			const p = playlistById.get(pid);
			if (!p) return null;
			return {
				id: p.id,
				spotifyId: p.spotify_id ?? "",
				name: p.name,
				// match_intent is the real "what it's for"; fall back to the imported
				// Spotify description when the user hasn't written one.
				reason: p.match_intent ?? p.description ?? "",
				matchScore: fakeScore(song.id, pid),
				imageUrl: p.image_url,
				songCount: p.song_count,
			};
		})
			.filter((m): m is NonNullable<typeof m> => m !== null)
			.sort((a, b) => b.matchScore - a.matchScore)
			.slice(0, MATCHES_PER_SONG);
	}

	const fixture = {
		songs: songs.map((s) => ({
			id: s.id,
			spotifyId: s.spotify_id,
			name: s.name,
			artist: s.artists?.[0] ?? "Unknown Artist",
			album: s.album_name,
			albumArtUrl: s.image_url,
			genres: s.genres ?? [],
			audioFeatures: null,
			analysis: null,
		})),
		matchesBySong,
		playlistTracks,
	};

	// Tab indentation to match Biome's JSON formatter, so the generated file stays
	// lint-clean across rebuilds.
	writeFileSync(OUT, `${JSON.stringify(fixture, null, "\t")}\n`);
	console.log(
		`Wrote match-experience.json — ${fixture.songs.length} songs, ${PLAYLIST_IDS.length} playlists, ${trackRows.length} real tracks`,
	);
} finally {
	await sql.end();
}
