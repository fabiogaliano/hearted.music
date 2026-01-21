#!/usr/bin/env bun
/**
 * Smoke Test: Full Matching Pipeline
 *
 * Tests the COMPLETE matching flow with real API calls:
 *   1. Fetch genres from Last.fm
 *   2. Fetch audio features from ReccoBeats
 *   3. Build song objects with real data
 *   4. Run MatchingService against mock playlist profiles
 *
 * This demonstrates how real songs would flow through the pipeline.
 *
 * Usage:
 *   bun scripts/smoke-tests/matching-pipeline.ts
 *
 * Prerequisites:
 *   - Valid .env with LASTFM_API_KEY (optional, graceful degradation)
 *   - Internet connection for ReccoBeats (free, no key)
 */

import { Result } from "better-result";
import { createLastFmService } from "@/lib/integrations/lastfm/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import { createMatchingService } from "@/lib/capabilities/matching/service";
import type {
	MatchingSong,
	MatchingPlaylistProfile,
	MatchingAudioFeatures,
} from "@/lib/capabilities/matching/types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
};

function log(icon: string, message: string) {
	console.log(`${icon} ${message}`);
}

function success(message: string) {
	log(`${colors.green}✓${colors.reset}`, message);
}

function fail(message: string) {
	log(`${colors.red}✗${colors.reset}`, message);
}

function info(message: string) {
	log(`${colors.cyan}→${colors.reset}`, message);
}

function dim(message: string) {
	console.log(`  ${colors.dim}${message}${colors.reset}`);
}

function header(title: string) {
	console.log(`\n${colors.bold}${colors.cyan}━━━ ${title} ━━━${colors.reset}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Data: Real Spotify Tracks
// ─────────────────────────────────────────────────────────────────────────────

interface TestTrack {
	spotifyId: string;
	name: string;
	artists: string[];
	album?: string;
	expectedGenreHint: string; // What genre we expect (for validation)
}

const TEST_TRACKS: TestTrack[] = [
	{
		spotifyId: "4u7EnebtmKWzUH433cf5Qv",
		name: "Bohemian Rhapsody",
		artists: ["Queen"],
		album: "A Night at the Opera",
		expectedGenreHint: "rock",
	},
	{
		spotifyId: "0VjIjW4GlUZAMYd2vXMi3b",
		name: "Blinding Lights",
		artists: ["The Weeknd"],
		album: "After Hours",
		expectedGenreHint: "synth",
	},
	{
		spotifyId: "3n3Ppam7vgaVa1iaRUc9Lp",
		name: "Mr. Brightside",
		artists: ["The Killers"],
		album: "Hot Fuss",
		expectedGenreHint: "rock",
	},
	{
		spotifyId: "7qiZfU4dY1lWllzX7mPBI3",
		name: "Shape of You",
		artists: ["Ed Sheeran"],
		album: "÷",
		expectedGenreHint: "pop",
	},
];

// ─────────────────────────────────────────────────────────────────────────────
// Mock Playlist Profiles (simulating user's destination playlists)
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_PLAYLISTS: MatchingPlaylistProfile[] = [
	{
		playlistId: "pl-classic-rock",
		embedding: null,
		audioCentroid: {
			energy: 0.7,
			valence: 0.6,
			danceability: 0.5,
			acousticness: 0.3,
			instrumentalness: 0.2,
		},
		genreDistribution: {
			rock: 15,
			"classic rock": 12,
			"hard rock": 5,
			"progressive rock": 3,
			queen: 2,
		},
		emotionDistribution: { powerful: 8, energetic: 6 },
		themes: ["freedom", "rebellion", "epic"],
		listeningContexts: { driving: 0.8, workout: 0.5 },
	},
	{
		playlistId: "pl-synth-pop",
		embedding: null,
		audioCentroid: {
			energy: 0.8,
			valence: 0.7,
			danceability: 0.85,
			acousticness: 0.1,
			instrumentalness: 0.3,
		},
		genreDistribution: {
			"synth-pop": 10,
			synthwave: 8,
			electronic: 6,
			"new wave": 4,
			"80s": 3,
		},
		emotionDistribution: { euphoric: 8, nostalgic: 5 },
		themes: ["night", "neon", "retro"],
		listeningContexts: { party: 0.7, driving: 0.6 },
	},
	{
		playlistId: "pl-indie-rock",
		embedding: null,
		audioCentroid: {
			energy: 0.75,
			valence: 0.55,
			danceability: 0.6,
			acousticness: 0.25,
			instrumentalness: 0.15,
		},
		genreDistribution: {
			"indie rock": 12,
			"alternative rock": 8,
			rock: 6,
			"post-punk revival": 4,
		},
		emotionDistribution: { energetic: 7, melancholic: 4 },
		themes: ["youth", "angst", "love"],
		listeningContexts: { workout: 0.6, focus: 0.4 },
	},
	{
		playlistId: "pl-pop-hits",
		embedding: null,
		audioCentroid: {
			energy: 0.7,
			valence: 0.75,
			danceability: 0.8,
			acousticness: 0.2,
			instrumentalness: 0.05,
		},
		genreDistribution: {
			pop: 15,
			"dance pop": 8,
			"uk pop": 5,
			"acoustic pop": 3,
		},
		emotionDistribution: { happy: 10, upbeat: 7 },
		themes: ["love", "fun", "summer"],
		listeningContexts: { party: 0.8, workout: 0.6 },
	},
];

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 1: Fetch genres from Last.fm
 */
async function fetchGenres(tracks: TestTrack[]): Promise<Map<string, { tags: string[]; source: string }>> {
	const result = new Map<string, { tags: string[]; source: string }>();

	const lastFmResult = createLastFmService();
	if (lastFmResult === null) {
		info("LASTFM_API_KEY not set - skipping genre enrichment");
		return result;
	}

	if (Result.isError(lastFmResult)) {
		info(`Last.fm init failed: ${lastFmResult.error.message}`);
		return result;
	}

	const lastFm = lastFmResult.value;

	for (const track of tracks) {
		const tagsResult = await lastFm.getTagsWithFallback(
			track.artists[0],
			track.name,
			track.album,
		);

		if (Result.isOk(tagsResult) && tagsResult.value) {
			result.set(track.spotifyId, {
				tags: tagsResult.value.tags,
				source: tagsResult.value.sourceLevel,
			});
		}
	}

	return result;
}

/**
 * Stage 2: Fetch audio features from ReccoBeats
 */
async function fetchAudioFeatures(tracks: TestTrack[]): Promise<Map<string, MatchingAudioFeatures>> {
	const result = new Map<string, MatchingAudioFeatures>();
	const reccoBeats = createReccoBeatsService();

	const ids = tracks.map((t) => t.spotifyId);
	const batchResult = await reccoBeats.getAudioFeaturesBatch(ids);

	if (Result.isOk(batchResult)) {
		for (const [id, features] of batchResult.value.features) {
			result.set(id, {
				energy: features.energy,
				valence: features.valence,
				danceability: features.danceability,
				acousticness: features.acousticness,
				instrumentalness: features.instrumentalness,
				speechiness: features.speechiness,
				liveness: features.liveness,
				tempo: features.tempo,
				loudness: features.loudness,
			});
		}
	}

	return result;
}

/**
 * Stage 3: Build MatchingSong objects
 */
function buildMatchingSongs(
	tracks: TestTrack[],
	genres: Map<string, { tags: string[]; source: string }>,
	audioFeatures: Map<string, MatchingAudioFeatures>,
): MatchingSong[] {
	return tracks.map((track) => {
		const genreData = genres.get(track.spotifyId);
		const audio = audioFeatures.get(track.spotifyId);

		return {
			id: `song-${track.spotifyId}`,
			spotifyId: track.spotifyId,
			name: track.name,
			artists: track.artists,
			genres: genreData?.tags.slice(0, 5) ?? null, // Top 5 genres
			audioFeatures: audio ?? null,
			analysis: null, // Would come from LLM analysis in production
		};
	});
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║       🎵 Full Matching Pipeline Smoke Test                ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}

This test runs the COMPLETE matching flow with real API calls:
  1. Fetch genres from Last.fm API
  2. Fetch audio features from ReccoBeats API
  3. Build MatchingSong objects
  4. Run MatchingService against 4 mock playlists
`);

	// ════════════════════════════════════════════════════════════════════════
	// Stage 1: Genre Enrichment
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 1: Genre Enrichment (Last.fm)");

	info("Fetching genres for test tracks...");
	const genres = await fetchGenres(TEST_TRACKS);

	if (genres.size > 0) {
		success(`Got genres for ${genres.size}/${TEST_TRACKS.length} tracks`);
		for (const [id, data] of genres) {
			const track = TEST_TRACKS.find((t) => t.spotifyId === id)!;
			dim(`${track.name}: [${data.tags.slice(0, 3).join(", ")}] (${data.source})`);
		}
	} else {
		info("No genres fetched (Last.fm unavailable) - matching will use other factors");
	}

	// ════════════════════════════════════════════════════════════════════════
	// Stage 2: Audio Features
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 2: Audio Features (ReccoBeats)");

	info("Fetching audio features for test tracks...");
	const audioFeatures = await fetchAudioFeatures(TEST_TRACKS);

	if (audioFeatures.size > 0) {
		success(`Got audio features for ${audioFeatures.size}/${TEST_TRACKS.length} tracks`);
		for (const [id, features] of audioFeatures) {
			const track = TEST_TRACKS.find((t) => t.spotifyId === id)!;
			dim(`${track.name}: energy=${features.energy.toFixed(2)}, valence=${features.valence.toFixed(2)}, dance=${features.danceability.toFixed(2)}`);
		}
	} else {
		fail("No audio features fetched - ReccoBeats API may be down");
	}

	// ════════════════════════════════════════════════════════════════════════
	// Stage 3: Build Song Objects
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 3: Build MatchingSong Objects");

	const songs = buildMatchingSongs(TEST_TRACKS, genres, audioFeatures);
	success(`Built ${songs.length} MatchingSong objects`);

	for (const song of songs) {
		const hasGenres = song.genres && song.genres.length > 0;
		const hasAudio = !!song.audioFeatures;
		dim(`${song.name}: genres=${hasGenres ? "✓" : "✗"}, audio=${hasAudio ? "✓" : "✗"}`);
	}

	// ════════════════════════════════════════════════════════════════════════
	// Stage 4: Run Matching
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 4: Matching Service");

	const matchingService = createMatchingService(null, null);
	info(`Matching ${songs.length} songs against ${MOCK_PLAYLISTS.length} playlists...\n`);

	const batchResult = await matchingService.matchBatch(songs, MOCK_PLAYLISTS);

	if (Result.isOk(batchResult)) {
		const { matches, stats } = batchResult.value;
		success(`Matching complete: ${stats.matched}/${stats.total} songs matched\n`);

		// Print results per song
		for (const song of songs) {
			const songMatches = matches.get(song.id);
			const track = TEST_TRACKS.find((t) => t.spotifyId === song.spotifyId)!;

			console.log(`${colors.bold}📀 ${song.name}${colors.reset} - ${song.artists.join(", ")}`);
			dim(`Expected: ${track.expectedGenreHint}`);

			if (songMatches && songMatches.length > 0) {
				for (const match of songMatches.slice(0, 3)) {
					const playlist = MOCK_PLAYLISTS.find((p) => p.playlistId === match.playlistId)!;
					const playlistName = playlist.playlistId.replace("pl-", "").replace(/-/g, " ");
					const bar = "█".repeat(Math.round(match.score * 20)) + "░".repeat(20 - Math.round(match.score * 20));
					console.log(`   ${colors.cyan}#${match.rank}${colors.reset} ${playlistName.padEnd(15)} ${bar} ${(match.score * 100).toFixed(1)}%`);
					dim(`      factors: genre=${match.factors.genre.toFixed(2)}, audio=${match.factors.audio.toFixed(2)}, vector=${match.factors.vector.toFixed(2)}`);
				}
			} else {
				dim("   No matches (below threshold)");
			}
			console.log("");
		}
	} else {
		fail("Batch matching failed");
		process.exit(1);
	}

	// ════════════════════════════════════════════════════════════════════════
	// Summary
	// ════════════════════════════════════════════════════════════════════════
	console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════${colors.reset}
`);

	console.log(`${colors.green}✅ Full pipeline smoke test complete!${colors.reset}\n`);

	console.log(`${colors.bold}Pipeline Coverage:${colors.reset}`);
	console.log(`   • Last.fm genres:     ${genres.size > 0 ? `${colors.green}✓${colors.reset} ${genres.size} tracks` : `${colors.yellow}⚠ skipped (no API key)${colors.reset}`}`);
	console.log(`   • ReccoBeats audio:   ${audioFeatures.size > 0 ? `${colors.green}✓${colors.reset} ${audioFeatures.size} tracks` : `${colors.red}✗ failed${colors.reset}`}`);
	console.log(`   • MatchingService:    ${colors.green}✓${colors.reset} ${songs.length} songs matched`);
	console.log("");

	// Validate expected matches make sense
	if (Result.isOk(batchResult)) {
		const { matches } = batchResult.value;
		let sensibleMatches = 0;

		for (const song of songs) {
			const songMatches = matches.get(song.id);
			const track = TEST_TRACKS.find((t) => t.spotifyId === song.spotifyId)!;

			if (songMatches && songMatches.length > 0) {
				const bestMatch = songMatches[0];
				const playlistName = bestMatch.playlistId.toLowerCase();

				// Check if best match aligns with expected genre
				if (playlistName.includes(track.expectedGenreHint) ||
				    (track.expectedGenreHint === "rock" && (playlistName.includes("rock") || playlistName.includes("indie"))) ||
				    (track.expectedGenreHint === "synth" && playlistName.includes("synth"))) {
					sensibleMatches++;
				}
			}
		}

		console.log(`${colors.bold}Match Quality:${colors.reset}`);
		console.log(`   • Sensible matches:   ${sensibleMatches}/${songs.length} songs matched expected playlist type`);
		console.log("");
	}
}

main().catch((err) => {
	fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
	console.error(err);
	process.exit(1);
});
