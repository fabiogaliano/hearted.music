/**
 * Local Reranking Demo
 *
 * Demonstrates local provider with reranking support.
 * Run with: ML_PROVIDER=local bun run scripts/smoke-tests/local-reranking-demo.ts
 *
 * Note: First run will download ~100MB reranker model. Subsequent runs use cached model.
 */

import { Result } from "better-result";
import { getMlProvider } from "@/lib/ml/provider/factory";

async function main() {
	console.log("=".repeat(60));
	console.log("Local Provider Reranking Demo");
	console.log("=".repeat(60));
	console.log();

	// Check environment
	if (process.env.ML_PROVIDER !== "local") {
		console.error("❌ This demo requires ML_PROVIDER=local");
		console.error("   Run: ML_PROVIDER=local bun run scripts/smoke-tests/local-reranking-demo.ts");
		process.exit(1);
	}

	// Get provider
	console.log("📦 Loading local ML provider...");
	const providerResult = getMlProvider();

	if (Result.isError(providerResult)) {
		console.error("❌ Failed to load provider:", providerResult.error);
		process.exit(1);
	}

	const provider = providerResult.value;
	const metadata = provider.getMetadata();

	console.log("✅ Provider loaded:");
	console.log(`   Name: ${metadata.name}`);
	console.log(`   Embedding: ${metadata.embeddingModel} (${metadata.embeddingDims} dims)`);
	console.log(`   Reranker: ${metadata.rerankerModel}`);
	console.log();

	// Test query and documents
	const query = "machine learning and artificial intelligence";
	const documents = [
		"Deep learning is a subset of machine learning that uses neural networks",
		"The weather is sunny and warm today",
		"Natural language processing is an AI technique for understanding text",
		"I enjoy cooking pasta with tomato sauce",
		"Computer vision enables machines to interpret visual information",
		"My favorite color is blue",
	];

	console.log("🔍 Query:", query);
	console.log("📄 Documents to rank:");
	documents.forEach((doc, i) => {
		console.log(`   ${i + 1}. ${doc.substring(0, 60)}...`);
	});
	console.log();

	// Perform reranking
	console.log("⚙️  Running reranking (first time may be slow - downloading model)...");
	const startTime = Date.now();

	const rerankResult = await provider.rerank(query, documents, {
		topK: 3, // Get top 3 most relevant
	});

	const duration = Date.now() - startTime;

	if (Result.isError(rerankResult)) {
		console.error("❌ Reranking failed:", rerankResult.error);
		process.exit(1);
	}

	console.log(`✅ Reranking completed in ${duration}ms`);
	console.log();

	// Display results
	const { scores, model } = rerankResult.value;

	console.log("🏆 Top ranked documents:");
	console.log(`   Model: ${model}`);
	console.log();

	scores.forEach((score, rank) => {
		const doc = documents[score.index];
		console.log(`   ${rank + 1}. [Score: ${score.score.toFixed(4)}] ${doc}`);
	});
	console.log();

	// Show what was filtered out
	const includedIndices = new Set(scores.map((s) => s.index));
	const filtered = documents
		.map((doc, i) => ({ doc, index: i }))
		.filter((item) => !includedIndices.has(item.index));

	if (filtered.length > 0) {
		console.log("📤 Filtered out (lower relevance):");
		filtered.forEach((item) => {
			console.log(`   - ${item.doc}`);
		});
		console.log();
	}

	console.log("✅ Demo completed successfully!");
	console.log();
	console.log("💡 Observations:");
	console.log("   - AI-related documents ranked highest (relevant to query)");
	console.log("   - Weather, food, color documents ranked lowest (irrelevant)");
	console.log("   - Model runs locally with no API calls");
	console.log("   - Cached model loads faster on subsequent runs");
}

main().catch((error) => {
	console.error("❌ Unhandled error:", error);
	process.exit(1);
});
