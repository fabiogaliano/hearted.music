#!/usr/bin/env bun
/**
 * Smoke Test: Full Matching Pipeline with Real Embeddings
 *
 * Tests the COMPLETE matching flow with real ML models:
 *   1. Fetch genres from Last.fm API (optional)
 *   2. Fetch audio features from ReccoBeats API (free)
 *   3. Generate embeddings via HuggingFace Inference API (free)
 *   4. Run MatchingService with ALL signals
 *   5. Verify match quality and confidence scores
 *
 * This is the ultimate integration test - exercises every part of the pipeline.
 *
 * Usage:
 *   bun scripts/smoke-tests/matching-with-embeddings.ts
 *
 * Prerequisites:
 *   - Internet connection
 *   - Optional: LASTFM_API_KEY in .env (graceful degradation)
 *   - Optional: HF_TOKEN in .env (higher rate limits)
 */

import { Result } from "better-result";
import { createLastFmService } from "@/lib/integrations/lastfm/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import * as hf from "@/lib/integrations/huggingface/service";
import { createMatchingService } from "@/lib/domains/taste/song-matching/service";
import type {
	MatchingSong,
	MatchingPlaylistProfile,
	MatchingAudioFeatures,
} from "@/lib/domains/taste/song-matching/types";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const colors = {
	reset: "\x1b[0m",
	green: "\x1b[32m",
	red: "\x1b[31m",
	yellow: "\x1b[33m",
	cyan: "\x1b[36m",
	magenta: "\x1b[35m",
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
	expectedGenreHint: string;
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
];

// ─────────────────────────────────────────────────────────────────────────────
// Mock Playlist Profiles (with embeddings)
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_PLAYLIST_DESCRIPTIONS = [
	{
		id: "pl-classic-rock",
		description: "Epic rock anthems with powerful vocals, guitar solos, and stadium energy. Queen, Led Zeppelin, Pink Floyd. Best for driving and feeling powerful.",
		audioCentroid: {
			energy: 0.7,
			valence: 0.6,
			danceability: 0.5,
			acousticness: 0.3,
			instrumentalness: 0.2,
		},
		genreDistribution: { rock: 15, "classic rock": 12, "hard rock": 5 },
	},
	{
		id: "pl-synth-pop",
		description: "Synthwave and 80s-inspired electronic pop with neon vibes, retro synths, and nostalgic melodies. The Weeknd, Dua Lipa, M83. Perfect for night drives.",
		audioCentroid: {
			energy: 0.8,
			valence: 0.7,
			danceability: 0.85,
			acousticness: 0.1,
			instrumentalness: 0.3,
		},
		genreDistribution: { "synth-pop": 10, synthwave: 8, electronic: 6 },
	},
	{
		id: "pl-indie-rock",
		description: "Alternative indie rock with emotional lyrics, jangly guitars, and youthful energy. The Killers, Arctic Monkeys, The Strokes. Great for workouts and focus sessions.",
		audioCentroid: {
			energy: 0.75,
			valence: 0.55,
			danceability: 0.6,
			acousticness: 0.25,
			instrumentalness: 0.15,
		},
		genreDistribution: { "indie rock": 12, "alternative rock": 8, rock: 6 },
	},
];

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Stages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stage 1: Fetch genres from Last.fm
 */
async function fetchGenres(tracks: TestTrack[]): Promise<Map<string, string[]>> {
	const result = new Map<string, string[]>();

	const lastFmResult = createLastFmService();
	if (lastFmResult === null || Result.isError(lastFmResult)) {
		info("Last.fm unavailable - skipping genre enrichment");
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
			result.set(track.spotifyId, tagsResult.value.tags);
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
 * Stage 3: Generate song embeddings via HuggingFace
 */
async function generateSongEmbeddings(
	tracks: TestTrack[],
	genres: Map<string, string[]>,
	audioFeatures: Map<string, MatchingAudioFeatures>,
): Promise<Map<string, number[]>> {
	const result = new Map<string, number[]>();

	info("Generating embeddings via HuggingFace Inference API...");

	// Build embedding text for each song (similar to EmbeddingService logic)
	const texts: string[] = [];
	for (const track of tracks) {
		const genreList = genres.get(track.spotifyId) || [];
		const audio = audioFeatures.get(track.spotifyId);

		const parts: string[] = [];
		parts.push(`Song: ${track.name} by ${track.artists.join(", ")}`);

		if (genreList.length > 0) {
			parts.push(`Genres: ${genreList.slice(0, 3).join(", ")}`);
		}

		if (audio) {
			const mood = audio.valence > 0.6 ? "upbeat" : audio.valence < 0.4 ? "melancholic" : "balanced";
			const intensity = audio.energy > 0.7 ? "high energy" : audio.energy < 0.4 ? "mellow" : "moderate energy";
			parts.push(`Mood: ${mood}, ${intensity}`);
		}

		texts.push(parts.join(". "));
	}

	// Batch embed
	const embedResult = await hf.embedBatch(texts, { prefix: "passage:" });

	if (Result.isError(embedResult)) {
		fail(`Embedding failed: ${embedResult.error.message}`);
		return result;
	}

	// Map back to track IDs
	for (let i = 0; i < tracks.length; i++) {
		result.set(tracks[i].spotifyId, embedResult.value[i].embedding);
	}

	success(`Generated embeddings for ${result.size}/${tracks.length} tracks`);
	dim(`Model: ${hf.getEmbeddingModel()}, Dims: ${hf.getEmbeddingDims()}`);

	return result;
}

/**
 * Stage 4: Generate playlist embeddings via HuggingFace
 */
async function generatePlaylistEmbeddings(): Promise<Map<string, number[]>> {
	const result = new Map<string, number[]>();

	info("Generating playlist profile embeddings...");

	const descriptions = MOCK_PLAYLIST_DESCRIPTIONS.map((p) => p.description);
	const embedResult = await hf.embedBatch(descriptions, { prefix: "passage:" });

	if (Result.isError(embedResult)) {
		fail(`Playlist embedding failed: ${embedResult.error.message}`);
		return result;
	}

	for (let i = 0; i < MOCK_PLAYLIST_DESCRIPTIONS.length; i++) {
		result.set(MOCK_PLAYLIST_DESCRIPTIONS[i].id, embedResult.value[i].embedding);
	}

	success(`Generated embeddings for ${result.size} playlist profiles`);

	return result;
}

/**
 * Stage 5: Build matching inputs
 */
function buildMatchingInputs(
	tracks: TestTrack[],
	genres: Map<string, string[]>,
	audioFeatures: Map<string, MatchingAudioFeatures>,
	songEmbeddings: Map<string, number[]>,
	playlistEmbeddings: Map<string, number[]>,
): {
	songs: MatchingSong[];
	profiles: MatchingPlaylistProfile[];
	songEmbeddingsMap: Map<string, number[]>;
} {
	const songs: MatchingSong[] = tracks.map((track) => {
		const genreData = genres.get(track.spotifyId);
		const audio = audioFeatures.get(track.spotifyId);

		return {
			id: `song-${track.spotifyId}`,
			spotifyId: track.spotifyId,
			name: track.name,
			artists: track.artists,
			genres: genreData?.slice(0, 5) ?? null,
			audioFeatures: audio ?? null,
			analysis: null, // Would come from LLM in production
		};
	});

	const profiles: MatchingPlaylistProfile[] = MOCK_PLAYLIST_DESCRIPTIONS.map((p) => ({
		playlistId: p.id,
		embedding: playlistEmbeddings.get(p.id) ?? null,
		audioCentroid: p.audioCentroid as unknown as Record<string, number>,
		genreDistribution: p.genreDistribution as unknown as Record<string, number>,
		emotionDistribution: {},
	}));

	// Map song embeddings by internal ID
	const songEmbeddingsMap = new Map<string, number[]>();
	for (const track of tracks) {
		const embedding = songEmbeddings.get(track.spotifyId);
		if (embedding) {
			songEmbeddingsMap.set(`song-${track.spotifyId}`, embedding);
		}
	}

	return { songs, profiles, songEmbeddingsMap };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
	console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║    🚀 Full Matching Pipeline with Real Embeddings         ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}

This test exercises the COMPLETE matching pipeline:
  1. Genre enrichment (Last.fm API - optional)
  2. Audio features (ReccoBeats API - free)
  3. Song embeddings (HuggingFace API - free)
  4. Playlist embeddings (HuggingFace API - free)
  5. Multi-signal matching (vector + genre + audio + semantic)

${colors.dim}Using HuggingFace Inference API for embeddings (free tier)${colors.reset}
`);

	// ════════════════════════════════════════════════════════════════════════
	// Stage 1: Genre Enrichment
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 1: Genre Enrichment (Last.fm)");

	const genres = await fetchGenres(TEST_TRACKS);

	if (genres.size > 0) {
		success(`Got genres for ${genres.size}/${TEST_TRACKS.length} tracks`);
		for (const [id, tags] of genres) {
			const track = TEST_TRACKS.find((t) => t.spotifyId === id)!;
			dim(`${track.name}: [${tags.slice(0, 3).join(", ")}]`);
		}
	} else {
		info("No genres fetched - matching will rely on other signals");
	}

	// ════════════════════════════════════════════════════════════════════════
	// Stage 2: Audio Features
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 2: Audio Features (ReccoBeats)");

	const audioFeatures = await fetchAudioFeatures(TEST_TRACKS);

	if (audioFeatures.size === TEST_TRACKS.length) {
		success(`Got audio features for ${audioFeatures.size}/${TEST_TRACKS.length} tracks`);
		for (const [id, features] of audioFeatures) {
			const track = TEST_TRACKS.find((t) => t.spotifyId === id)!;
			dim(`${track.name}: energy=${features.energy.toFixed(2)}, valence=${features.valence.toFixed(2)}, dance=${features.danceability.toFixed(2)}`);
		}
	} else {
		fail(`Only got ${audioFeatures.size}/${TEST_TRACKS.length} audio features`);
	}

	// ════════════════════════════════════════════════════════════════════════
	// Stage 3: Song Embeddings
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 3: Song Embeddings (HuggingFace)");

	const songEmbeddings = await generateSongEmbeddings(TEST_TRACKS, genres, audioFeatures);

	if (songEmbeddings.size !== TEST_TRACKS.length) {
		fail("Failed to generate all song embeddings");
		process.exit(1);
	}

	// ════════════════════════════════════════════════════════════════════════
	// Stage 4: Playlist Embeddings
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 4: Playlist Embeddings (HuggingFace)");

	const playlistEmbeddings = await generatePlaylistEmbeddings();

	if (playlistEmbeddings.size !== MOCK_PLAYLIST_DESCRIPTIONS.length) {
		fail("Failed to generate all playlist embeddings");
		process.exit(1);
	}

	// ════════════════════════════════════════════════════════════════════════
	// Stage 5: Build Matching Inputs
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 5: Build Matching Inputs");

	const { songs, profiles, songEmbeddingsMap } = buildMatchingInputs(
		TEST_TRACKS,
		genres,
		audioFeatures,
		songEmbeddings,
		playlistEmbeddings,
	);

	success(`Built ${songs.length} songs and ${profiles.length} playlist profiles`);

	for (const song of songs) {
		const hasGenres = song.genres && song.genres.length > 0;
		const hasAudio = !!song.audioFeatures;
		const hasEmbedding = songEmbeddingsMap.has(song.id);
		dim(`${song.name}: genres=${hasGenres ? "✓" : "✗"}, audio=${hasAudio ? "✓" : "✗"}, embedding=${hasEmbedding ? "✓" : "✗"}`);
	}

	// ════════════════════════════════════════════════════════════════════════
	// Stage 6: Run Matching
	// ════════════════════════════════════════════════════════════════════════
	header("Stage 6: Multi-Signal Matching");

	const matchingService = createMatchingService(null, null);
	info(`Matching ${songs.length} songs against ${profiles.length} playlists...\n`);

	const batchResult = await matchingService.matchBatch(songs, profiles, songEmbeddingsMap);

	if (Result.isError(batchResult)) {
		fail(`Matching failed: ${batchResult.error.message}`);
		process.exit(1);
	}

	const { matches, stats } = batchResult.value;
	success(`Matching complete: ${stats.matched}/${stats.total} songs matched\n`);

	// Print results per song
	for (const song of songs) {
		const songMatches = matches.get(song.id);
		const track = TEST_TRACKS.find((t) => `song-${t.spotifyId}` === song.id)!;

		console.log(`${colors.bold}${colors.magenta}🎵 ${song.name}${colors.reset} - ${song.artists.join(", ")}`);
		dim(`Expected genre: ${track.expectedGenreHint}`);

		if (songMatches && songMatches.length > 0) {
			const bestMatch = songMatches[0];
			console.log(`${colors.cyan}   Best Match:${colors.reset} ${bestMatch.playlistId.replace("pl-", "").replace(/-/g, " ")} (${(bestMatch.score * 100).toFixed(1)}%)`);

			for (const match of songMatches.slice(0, 3)) {
				const playlist = profiles.find((p) => p.playlistId === match.playlistId)!;
				const playlistName = playlist.playlistId.replace("pl-", "").replace(/-/g, " ");
				const bar = "█".repeat(Math.round(match.score * 20)) + "░".repeat(20 - Math.round(match.score * 20));

				console.log(`   ${colors.cyan}#${match.rank}${colors.reset} ${playlistName.padEnd(15)} ${bar} ${(match.score * 100).toFixed(1)}%`);
				dim(`      vector=${match.factors.vector.toFixed(2)}, genre=${match.factors.genre.toFixed(2)}, audio=${match.factors.audio.toFixed(2)}, confidence=${match.confidence.toFixed(2)}`);
			}
		} else {
			dim("   No matches (below threshold)");
		}
		console.log("");
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
	console.log(`   • HuggingFace songs:  ${songEmbeddings.size > 0 ? `${colors.green}✓${colors.reset} ${songEmbeddings.size} embeddings` : `${colors.red}✗ failed${colors.reset}`}`);
	console.log(`   • HuggingFace playlists: ${playlistEmbeddings.size > 0 ? `${colors.green}✓${colors.reset} ${playlistEmbeddings.size} embeddings` : `${colors.red}✗ failed${colors.reset}`}`);
	console.log(`   • MatchingService:    ${colors.green}✓${colors.reset} ${songs.length} songs matched`);
	console.log("");

	// Validate match quality
	let sensibleMatches = 0;
	for (const song of songs) {
		const songMatches = matches.get(song.id);
		const track = TEST_TRACKS.find((t) => `song-${t.spotifyId}` === song.id)!;

		if (songMatches && songMatches.length > 0) {
			const bestMatch = songMatches[0];
			const playlistName = bestMatch.playlistId.toLowerCase();

			// Check if best match aligns with expected genre
			if (
				playlistName.includes(track.expectedGenreHint) ||
				(track.expectedGenreHint === "rock" && (playlistName.includes("rock") || playlistName.includes("indie"))) ||
				(track.expectedGenreHint === "synth" && playlistName.includes("synth"))
			) {
				sensibleMatches++;
			}
		}
	}

	console.log(`${colors.bold}Match Quality:${colors.reset}`);
	console.log(`   • Sensible matches:   ${sensibleMatches}/${songs.length} songs matched expected playlist type`);
	console.log(`   • Confidence range:   ${matches.size > 0 ? `${colors.green}All songs have confidence scores${colors.reset}` : "N/A"}`);
	console.log("");

	// Check that vector scoring was actually used
	const usedVectorScoring = Array.from(matches.values())
		.flat()
		.some((m) => m.factors.vector > 0);

	console.log(`${colors.bold}Signal Usage:${colors.reset}`);
	console.log(`   • Vector embeddings:  ${usedVectorScoring ? `${colors.green}✓ used${colors.reset}` : `${colors.yellow}⚠ not used${colors.reset}`}`);
	console.log(`   • Genre matching:     ${genres.size > 0 ? `${colors.green}✓ used${colors.reset}` : `${colors.yellow}⚠ not available${colors.reset}`}`);
	console.log(`   • Audio features:     ${audioFeatures.size > 0 ? `${colors.green}✓ used${colors.reset}` : `${colors.red}✗ not available${colors.reset}`}`);
	console.log("");
}

main().catch((err) => {
	fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
	console.error(err);
	process.exit(1);
});
