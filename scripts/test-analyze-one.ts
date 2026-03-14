/**
 * Disposable: analyze a single song and watch what happens.
 * Usage: bun scripts/test-analyze-one.ts
 */

import { Result } from "better-result";
import { createAnalysisPipeline } from "@/lib/domains/enrichment/content-analysis/pipeline";
import { selectPipelineBatch } from "@/lib/workflows/enrichment-pipeline/batch";
import { createAdminSupabaseClient } from "@/lib/data/client";

const supabase = createAdminSupabaseClient();
const { data: account } = await supabase.from("account").select("id").limit(1).single();
if (!account) { console.error("No account"); process.exit(1); }

console.log("1. Selecting batch...");
const batch = await selectPipelineBatch(account.id, 1);
if (batch.songIds.length === 0) { console.log("No songs"); process.exit(0); }

const songId = batch.songIds[0];
console.log(`   Song ID: ${songId}`);

console.log("2. Creating analysis pipeline...");
const pipelineResult = createAnalysisPipeline();
if (Result.isError(pipelineResult)) {
	console.error("Pipeline creation failed:", pipelineResult.error.message);
	process.exit(1);
}
const pipeline = pipelineResult.value;

console.log("3. Getting songs needing analysis...");
const needingResult = await pipeline.getSongsNeedingAnalysis(account.id, 1);
if (Result.isError(needingResult)) {
	console.error("getSongsNeedingAnalysis error:", needingResult.error);
	process.exit(1);
}
console.log(`   Songs needing analysis: ${needingResult.value.length}`);
for (const s of needingResult.value) {
	console.log(`   - ${s.songId}: ${s.artist} - ${s.title}`);
}

if (needingResult.value.length === 0) {
	console.log("\n4. Checking DB directly for this song...");
	const { data, error } = await supabase
		.from("song_analysis")
		.select("song_id, created_at, model")
		.eq("song_id", songId);
	console.log(`   DB rows: ${data?.length ?? 0}`, error ? `error: ${error.message}` : "");
	if (data?.length) console.log("   ", data[0]);

	console.log("\n   Song already analyzed — nothing to do.");
	process.exit(0);
}

console.log("4. Running analyzeSongs...");
const analyzeResult = await pipeline.analyzeSongs(account.id, needingResult.value.slice(0, 1));
if (Result.isError(analyzeResult)) {
	console.error("analyzeSongs failed:", analyzeResult.error);
	process.exit(1);
}

console.log(`   Result: succeeded=${analyzeResult.value.succeeded}, failed=${analyzeResult.value.failed}`);

console.log("5. Verifying DB...");
const { data: rows } = await supabase
	.from("song_analysis")
	.select("song_id, created_at, model")
	.eq("song_id", songId);
console.log(`   DB rows after: ${rows?.length ?? 0}`);
if (rows?.length) console.log("   ", rows[0]);
