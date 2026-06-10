/**
 * Re-embed every analyzed song with the active embedding model.
 *
 * Run after a model/format/dimension change once the migration has cleared the
 * old vectors (see supabase/migrations/*_qwen3_embeddings_512.sql). Re-profiling
 * playlists afterwards is a separate step:
 *   bun run scripts/reembed-all-songs.ts
 *   bun run scripts/matching-lab/reprofile-playlists.ts
 *
 * Provider-agnostic: uses whatever EmbeddingService.create() resolves from env
 * (DeepInfra in production; ML_PROVIDER=local + the sidecar in dev). Reads and
 * writes both go through the env-configured admin client, so SUPABASE_URL alone
 * decides which database is touched.
 */

import { Result } from "better-result";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { createAdminSupabaseClient } from "@/lib/data/client";

const supabase = createAdminSupabaseClient();

const BATCH_SIZE = 64;
// PostgREST caps a single response at max_rows (1000); page past it.
const PAGE_SIZE = 1000;

async function loadAnalyzedSongIds(): Promise<string[]> {
	const ids = new Set<string>();
	for (let from = 0; ; from += PAGE_SIZE) {
		const { data, error } = await supabase
			.from("song_analysis")
			.select("song_id")
			.order("song_id")
			.range(from, from + PAGE_SIZE - 1);

		if (error || !data) {
			console.error("❌ Failed to load analyzed songs:", error);
			process.exit(1);
		}
		for (const row of data) {
			ids.add(row.song_id);
		}
		if (data.length < PAGE_SIZE) {
			return [...ids];
		}
	}
}

async function main() {
	const serviceResult = EmbeddingService.create();
	if (Result.isError(serviceResult)) {
		console.error("❌ Failed to create EmbeddingService:", serviceResult.error);
		process.exit(1);
	}
	const service = serviceResult.value;
	console.log(
		`🔁 Re-embedding with ${service.getModel()} @ ${service.getDimensions()}d\n`,
	);

	// Every song that has an analysis is eligible for a semantic embedding.
	const songIds = await loadAnalyzedSongIds();
	console.log(`  ${songIds.length} analyzed songs to embed\n`);

	let succeeded = 0;
	const failures: Array<{ songId: string; error: string }> = [];

	for (let i = 0; i < songIds.length; i += BATCH_SIZE) {
		const chunk = songIds.slice(i, i + BATCH_SIZE);
		const result = await service.embedBatch(chunk);

		if (Result.isError(result)) {
			console.error(`  ❌ Batch ${i / BATCH_SIZE + 1} failed:`, result.error);
			process.exit(1);
		}

		succeeded += result.value.succeeded.length;
		failures.push(...result.value.failed);
		console.log(
			`  batch ${i / BATCH_SIZE + 1}: +${result.value.succeeded.length} ok, ${result.value.failed.length} failed`,
		);
	}

	console.log(`\n✅ Embedded ${succeeded} songs`);
	if (failures.length > 0) {
		console.log(`⚠️  ${failures.length} failures:`);
		for (const f of failures.slice(0, 20)) {
			console.log(`   ${f.songId}: ${f.error}`);
		}
	}
	console.log("\nNext: bun run scripts/matching-lab/reprofile-playlists.ts");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
