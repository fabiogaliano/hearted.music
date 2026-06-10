/**
 * Re-profile playlists with cold-start HyDE expansion.
 *
 * For each target playlist, runs LLM expansion → embeds the rich
 * pseudo-document → upserts the profile. Useful for verifying that
 * cold-start profiling produces discriminative embeddings.
 *
 * Usage: bun run scripts/matching-lab/reprofile-playlists.ts
 */

import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createLlmService } from "@/lib/integrations/llm/service";
import { createPlaylistProfilingService } from "@/lib/domains/taste/playlist-profiling/service";
import * as songData from "@/lib/domains/library/songs/queries";
import { Result } from "better-result";
import { createLocalLabClient } from "./shared";

const supabase = createLocalLabClient();

async function main() {
	console.log("\n🔄 Re-profiling playlists with HyDE expansion...\n");

	const embeddingResult = EmbeddingService.create();
	if (Result.isError(embeddingResult)) {
		throw embeddingResult.error;
	}
	const embeddingService = embeddingResult.value;

	let llmService;
	try {
		llmService = createLlmService();
		console.log(`  LLM: ${llmService.getCurrentModel()}`);
	} catch (e) {
		console.error("  ❌ Failed to create LLM service:", e);
		process.exit(1);
	}

	const profilingService = createPlaylistProfilingService(
		embeddingService,
		llmService,
	);

	// Load all target playlists
	const { data: playlists, error } = await supabase
		.from("playlist")
		.select("id, name, description, account_id")
		.eq("is_target", true)
		.order("name");

	if (error || !playlists) {
		console.error("  ❌ Failed to load playlists:", error);
		process.exit(1);
	}

	console.log(`  Found ${playlists.length} target playlists\n`);

	for (const playlist of playlists) {
		console.log(`  ┌─ ${playlist.name}`);
		if (playlist.description) {
			console.log(`  │  desc: "${playlist.description}"`);
		}

		// Load songs in this playlist
		const { data: playlistSongs } = await supabase
			.from("playlist_song")
			.select("song_id")
			.eq("playlist_id", playlist.id);

		const songIds = (playlistSongs ?? []).map((ps) => ps.song_id);
		const songsResult = songIds.length > 0
			? await songData.getByIds(songIds)
			: Result.ok([]);

		const songs = Result.isOk(songsResult) ? songsResult.value : [];
		console.log(`  │  songs: ${songs.length}`);

		const result = await profilingService.computeProfile(playlist.id, songs, {
			name: playlist.name,
			description: playlist.description ?? undefined,
			skipCache: true,
		});

		if (Result.isOk(result)) {
			const p = result.value;
			const hasEmbedding = !!p.embedding;
			const genreCount = Object.keys(p.genreDistribution).length;
			const audioKeys = Object.keys(p.audioCentroid).length;
			const topGenres = Object.entries(p.genreDistribution)
				.sort(([, a], [, b]) => b - a)
				.slice(0, 5)
				.map(([g]) => g);

			console.log(`  │  embedding: ${hasEmbedding ? "✓" : "✗"} (dims: ${p.embedding?.length ?? 0})`);
			console.log(`  │  genres: ${genreCount} ${topGenres.length > 0 ? `[${topGenres.join(", ")}]` : ""}`);
			console.log(`  │  audio: ${audioKeys} features`);
			console.log(`  └─ ✅ profiled (${p.fromCache ? "cached" : "computed"})`);
		} else {
			console.log(`  └─ ❌ ${result.error.message}`);
		}
		console.log();
	}

	console.log("Done.\n");
}

main().catch(console.error);
