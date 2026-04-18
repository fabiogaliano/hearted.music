/**
 * Seed landing page songs through the real enrichment pipeline stages.
 *
 * Reads static JSON from public/landing-songs/, ensures songs exist in the DB,
 * then runs every account-independent pipeline stage using the actual services:
 *
 *   1. Upsert songs into `song` table (prerequisite — services need the UUID)
 *   2. Audio features   → ReccoBeatsService → song_audio_feature
 *   3. Genre tagging     → Last.fm → song.genres
 *   4. Song analysis     → Lyrics (Genius) + LLM → song_analysis
 *   5. Song embedding    → EmbeddingService → song_embedding
 *
 * Stages that require an account (content_activation, playlist_profiling) are skipped.
 *
 * Usage: bun scripts/seed-landing-songs.ts [--dry-run]
 */

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Result } from "better-result";
import * as songQueries from "@/lib/domains/library/songs/queries";
import type { Song } from "@/lib/domains/library/songs/queries";
import {
	createAudioFeaturesService,
	type TrackInfo,
} from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import { createGenreEnrichmentService } from "@/lib/domains/enrichment/genre-tagging/service";
import { SongAnalysisService } from "@/lib/domains/enrichment/content-analysis/song-analysis";
import { LlmService } from "@/lib/integrations/llm/service";
import { LyricsService } from "@/lib/domains/enrichment/lyrics/service";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { getApiKeyForProvider } from "@/lib/integrations/llm/config";
import type { AudioFeature } from "@/lib/domains/enrichment/audio-features/queries";
import type { LandingSongManifest } from "@/lib/data/landing-songs";

const LANDING_SONGS_DIR = resolve(
	import.meta.dirname,
	"../public/landing-songs",
);
const dryRun = process.argv.includes("--dry-run");

interface ManifestFile {
	generatedAt?: string;
	songs: LandingSongManifest[];
}

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function checkEnvKey(name: string, required: boolean): string | undefined {
	const val = process.env[name];
	if (val) {
		console.log(`  ✓ ${name}: ${val.substring(0, 8)}…`);
	} else if (required) {
		console.error(`  ✗ ${name} — required`);
		process.exit(1);
	} else {
		console.log(`  – ${name} not set (stage will degrade gracefully)`);
	}
	return val;
}

async function main() {
	const manifest = readJson<ManifestFile>(
		join(LANDING_SONGS_DIR, "index.json"),
	);
	const entries = manifest.songs;

	console.log(`\n🎵 Seeding ${entries.length} landing page songs\n`);

	if (dryRun) {
		for (const e of entries) console.log(`  → ${e.artist} — ${e.name}`);
		console.log("\n[DRY RUN — no writes]");
		return;
	}

	// --- Check env ---
	console.log("Environment:");
	const geminiKey = checkEnvKey("GEMINI_API_KEY", true);
	const geniusToken = checkEnvKey("GENIUS_CLIENT_TOKEN", false);
	checkEnvKey("LASTFM_API_KEY", false);
	checkEnvKey("DEEPINFRA_API_KEY", false);
	console.log();

	// -------------------------------------------------------------------------
	// Stage 0: Upsert songs (so we get UUIDs for downstream stages)
	// -------------------------------------------------------------------------
	console.log("── Stage 0: Upsert songs ──");

	const upsertData = entries.map((e) => ({
		spotify_id: e.spotifyTrackId,
		name: e.name,
		artists: [e.artist],
		artist_ids: [e.spotifyArtistId],
		album_name: e.album || null,
		image_url: e.albumArtUrl || null,
		genres: e.genres ?? [],
		album_id: null,
		isrc: null,
		duration_ms: null,
		popularity: null,
		preview_url: null,
	}));

	const upsertResult = await songQueries.upsert(upsertData);
	if (Result.isError(upsertResult)) {
		console.error("  ✗ Song upsert failed:", upsertResult.error.message);
		process.exit(1);
	}

	const songs = upsertResult.value;
	console.log(`  ✓ ${songs.length} songs upserted\n`);

	const songBySpotifyId = new Map<string, Song>();
	for (const s of songs) songBySpotifyId.set(s.spotify_id, s);

	// -------------------------------------------------------------------------
	// Stage 1: Audio features (ReccoBeats)
	// -------------------------------------------------------------------------
	console.log("── Stage 1: Audio features (ReccoBeats) ──");

	const reccoBeats = createReccoBeatsService();
	const audioService = createAudioFeaturesService(reccoBeats);

	const tracks: TrackInfo[] = songs.map((s) => ({
		songId: s.id,
		spotifyTrackId: s.spotify_id,
	}));

	const audioResult = await audioService.getOrFetchFeatures(tracks);
	const audioMap: Map<string, AudioFeature> = Result.isOk(audioResult)
		? audioResult.value
		: new Map();
	console.log(`  ✓ ${audioMap.size}/${songs.length} songs have audio features\n`);

	// -------------------------------------------------------------------------
	// Stage 2: Genre tagging (Last.fm)
	// -------------------------------------------------------------------------
	console.log("── Stage 2: Genre tagging (Last.fm) ──");

	const genreService = createGenreEnrichmentService();
	const genreInputs = songs.map((s) => ({
		songId: s.id,
		artist: s.artists[0] ?? "Unknown",
		trackName: s.name,
		album: s.album_name ?? undefined,
	}));

	const genreResult = await genreService.enrichBatch(genreInputs);
	if (Result.isOk(genreResult)) {
		const g = genreResult.value.stats;
		console.log(
			`  ✓ cached=${g.cached} fetched=${g.fetched} notFound=${g.notFound} failed=${g.failed}\n`,
		);
	} else {
		console.log(`  ⚠ Genre tagging failed: ${genreResult.error.message}\n`);
	}

	// -------------------------------------------------------------------------
	// Stage 3: Song analysis (Lyrics + LLM)
	// -------------------------------------------------------------------------
	console.log("── Stage 3: Song analysis (Genius + LLM) ──");

	const llm = new LlmService({ provider: "google", apiKey: geminiKey! });
	const analysisService = new SongAnalysisService(llm);
	const lyricsService = geniusToken
		? new LyricsService({ accessToken: geniusToken })
		: null;

	// Reload songs to get freshly-persisted genres from stage 2
	const refreshedSongs = await songQueries.getByIds(songs.map((s) => s.id));
	const genresMap = new Map<string, string[]>();
	if (Result.isOk(refreshedSongs)) {
		for (const s of refreshedSongs.value) {
			if (s.genres && s.genres.length > 0) genresMap.set(s.id, s.genres);
		}
	}

	let analysisSucceeded = 0;
	let analysisFailed = 0;
	let analysisCached = 0;

	for (const song of songs) {
		const artist = song.artists[0] ?? "Unknown";
		process.stdout.write(`  ${artist} — ${song.name} … `);

		// Fetch lyrics
		let lyrics: string | null = null;
		if (lyricsService) {
			const lr = await lyricsService.getLyricsText(artist, song.name);
			if (Result.isOk(lr) && lr.value) {
				lyrics = lr.value;
				process.stdout.write("lyrics ✓ ");
			} else {
				process.stdout.write("no lyrics ");
			}
		} else {
			process.stdout.write("(no Genius token) ");
		}

		const af = audioMap.get(song.id) ?? null;
		const genres = genresMap.get(song.id);

		const result = await analysisService.analyzeSong({
			songId: song.id,
			artist,
			title: song.name,
			lyrics,
			audioFeatures: af,
			genres,
			instrumentalness: af?.instrumentalness ?? undefined,
		});

		if (Result.isOk(result)) {
			if (result.value.cached) {
				console.log("(cached)");
				analysisCached++;
			} else {
				console.log(`✓ (${result.value.tokensUsed ?? "?"} tokens)`);
				analysisSucceeded++;
			}
		} else {
			console.log(`✗ ${result.error.message}`);
			analysisFailed++;
		}
	}

	console.log(
		`\n  → ${analysisSucceeded} new, ${analysisCached} cached, ${analysisFailed} failed\n`,
	);

	// -------------------------------------------------------------------------
	// Stage 4: Song embedding
	// -------------------------------------------------------------------------
	console.log("── Stage 4: Song embedding ──");

	let embeddingService: EmbeddingService | null = null;
	try {
		embeddingService = new EmbeddingService();
	} catch (e) {
		console.log(
			`  ⚠ EmbeddingService init failed (ML provider not configured): ${e instanceof Error ? e.message : e}`,
		);
		console.log("  Skipping embedding stage.\n");
	}

	if (embeddingService) {
		const songIds = songs.map((s) => s.id);
		const embedResult = await embeddingService.embedBatch(songIds);

		if (Result.isOk(embedResult)) {
			const { succeeded, failed } = embedResult.value;
			const cached = succeeded.filter((s) => s.cached).length;
			const fresh = succeeded.filter((s) => !s.cached).length;
			console.log(
				`  ✓ ${fresh} new, ${cached} cached, ${failed.length} failed`,
			);
			if (failed.length > 0) {
				for (const f of failed) console.log(`    ✗ ${f.songId}: ${f.error}`);
			}
		} else {
			console.log(`  ✗ Embedding batch failed: ${embedResult.error.message}`);
		}
		console.log();
	}

	// -------------------------------------------------------------------------
	// Done
	// -------------------------------------------------------------------------
	console.log("✅ All account-independent pipeline stages complete.");
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
