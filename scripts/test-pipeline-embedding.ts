/**
 * Disposable: run just the embedding stage of the pipeline.
 * Usage: bun scripts/test-pipeline-embedding.ts
 */

import { Result } from "better-result";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { selectPipelineBatch } from "@/lib/workflows/enrichment-pipeline/batch";

const accountId = process.env.TEST_ACCOUNT_ID;
if (!accountId) {
	// Fallback: grab from DB
	const { createAdminSupabaseClient } = await import("@/lib/data/client");
	const supabase = createAdminSupabaseClient();
	const { data } = await supabase.from("account").select("id").limit(1).single();
	if (!data) { console.error("No account found"); process.exit(1); }
	process.env.TEST_ACCOUNT_ID = data.id;
	console.log(`Using account: ${data.id}`);
}

const id = process.env.TEST_ACCOUNT_ID!;

console.log("1. Selecting batch...");
const batch = await selectPipelineBatch(id, 5);
console.log(`   Songs: ${batch.songIds.length}`);

if (batch.songIds.length === 0) {
	console.log("No songs in batch, nothing to embed.");
	process.exit(0);
}

console.log("2. Creating EmbeddingService...");
const service = new EmbeddingService();

console.log("3. Running embedBatch...");
const result = await service.embedBatch(batch.songIds);

if (Result.isError(result)) {
	console.error("embedBatch returned error:", result.error);
	process.exit(1);
}

console.log(`   Succeeded: ${result.value.succeeded.length}`);
console.log(`   Failed: ${result.value.failed.length}`);

for (const f of result.value.failed) {
	console.error(`   FAILED ${f.songId}: ${f.error}`);
}

for (const s of result.value.succeeded) {
	const dims = Array.isArray(s.embedding.embedding)
		? s.embedding.embedding.length
		: "stored";
	console.log(`   OK ${s.songId} (cached=${s.cached}, dims=${dims})`);
}
