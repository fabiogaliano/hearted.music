/**
 * Enrich the 20 landing/demo songs against a TARGET Supabase (intended: prod).
 *
 *   Stage 1 — Audio features via ReccoBeats (keyless). Skips songs that already
 *             have features; fetches the missing ones.
 *   Stage 2 — Embeddings via the configured ML provider. REFUSES to run unless
 *             the provider resolves to DeepInfra (Qwen3 → 512d), because the
 *             HuggingFace fallback emits 384d and would not fit vector(512).
 *             Reads each song's curated song_analysis as the embedding input,
 *             so curated analysis must already be inserted.
 *
 * Target is taken from SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the
 * environment. A guard aborts unless SUPABASE_URL is the known prod project,
 * so a stray local value can never silently send writes to the wrong DB.
 *
 * Usage (prod):
 *   SUPABASE_URL=https://oqrkjtidoodyzifurpmz.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<prod service_role> \
 *   [DEEPINFRA_API_KEY=<key>] \
 *   bun scripts/seed-demo-enrichment.ts
 */

import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { Result } from "better-result";
import { env } from "@/env";
import * as songQueries from "@/lib/domains/library/songs/queries";
import {
	createAudioFeaturesService,
	type TrackInfo,
} from "@/lib/integrations/audio/service";
import { createReccoBeatsService } from "@/lib/integrations/reccobeats/service";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { selectProvider } from "@/lib/integrations/providers/factory";

const PROD_REF = "oqrkjtidoodyzifurpmz";
const LANDING_SONGS_DIR = resolve(import.meta.dirname, "../public/landing-songs");

function readManifest(): { spotifyTrackId: string }[] {
	const m = JSON.parse(
		readFileSync(join(LANDING_SONGS_DIR, "index.json"), "utf-8"),
	) as { songs: { spotifyTrackId: string }[] };
	return m.songs;
}

async function main() {
	const url = env.SUPABASE_URL;
	const provider = selectProvider();
	console.log(`\nTarget SUPABASE_URL : ${url}`);
	console.log(`ML provider         : ${provider}`);

	// Guard: never write unless we are pointed at prod.
	if (!url.includes(PROD_REF)) {
		console.error(
			`\n✗ ABORT: SUPABASE_URL is not the prod project (${PROD_REF}). Refusing to write.`,
		);
		process.exit(1);
	}

	const spotifyIds = readManifest().map((s) => s.spotifyTrackId);

	// Resolve the song rows (must already exist — inserted in the SQL phase).
	const songsResult = await songQueries.getBySpotifyIds(spotifyIds);
	if (Result.isError(songsResult)) {
		console.error(`✗ Failed to load songs: ${songsResult.error.message}`);
		process.exit(1);
	}
	const songs = songsResult.value;
	console.log(`Resolved ${songs.length}/${spotifyIds.length} demo song rows\n`);

	// --- Stage 1: Audio features (ReccoBeats, keyless) ---
	console.log("── Stage 1: Audio features (ReccoBeats) ──");
	const audioService = createAudioFeaturesService(createReccoBeatsService());
	const tracks: TrackInfo[] = songs.map((s) => ({
		songId: s.id,
		spotifyTrackId: s.spotify_id,
	}));
	const audioResult = await audioService.getOrFetchFeatures(tracks);
	if (Result.isOk(audioResult)) {
		console.log(
			`  ✓ ${audioResult.value.features.size}/${songs.length} songs have features\n`,
		);
	} else {
		console.log(`  ⚠ features fetch failed: ${audioResult.error.message}\n`);
	}

	// --- Stage 2: Embeddings (DeepInfra only) ---
	console.log("── Stage 2: Embeddings ──");
	if (provider !== "deepinfra") {
		console.log(
			`  – Skipped: provider is '${provider}', not 'deepinfra'. Set DEEPINFRA_API_KEY to enable 512d Qwen3 embeddings.\n`,
		);
		console.log("✅ Done (features only).");
		return;
	}

	const embeddingResult = EmbeddingService.create();
	if (Result.isError(embeddingResult)) {
		console.error(`  ✗ EmbeddingService init failed: ${embeddingResult.error.message}`);
		process.exit(1);
	}
	const embeddingService = embeddingResult.value;
	const embedResult = await embeddingService.embedBatch(songs.map((s) => s.id));
	if (Result.isOk(embedResult)) {
		const { succeeded, failed } = embedResult.value;
		const fresh = succeeded.filter((s) => !s.cached).length;
		const cached = succeeded.filter((s) => s.cached).length;
		console.log(`  ✓ ${fresh} new, ${cached} cached, ${failed.length} failed`);
		for (const f of failed) console.log(`    ✗ ${f.songId}: ${f.error}`);
	} else {
		console.error(`  ✗ embedBatch failed: ${embedResult.error.message}`);
		process.exit(1);
	}
	console.log("\n✅ Done (features + embeddings).");
}

main().catch((err) => {
	console.error("Fatal:", err);
	process.exit(1);
});
