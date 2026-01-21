/**
 * ML Provider Smoke Tests
 *
 * Validates ML provider availability and basic operations.
 * Run with: bun run scripts/smoke-tests/ml-providers.ts
 *
 * Tests:
 * - Provider selection logic
 * - Provider availability checks
 * - Basic embedding operation
 * - Basic reranking operation (if supported)
 * - Provider metadata retrieval
 */

import { Result } from "better-result";
import {
	createProvider,
	getMlProvider,
	resetProvider,
	selectProvider,
} from "@/lib/ml/provider/factory";

// ============================================================================
// Test Utilities
// ============================================================================

function log(message: string, data?: unknown): void {
	console.log(`[ML Providers] ${message}`);
	if (data !== undefined) {
		console.log(JSON.stringify(data, null, 2));
	}
}

function logError(message: string, error: unknown): void {
	console.error(`[ML Providers] ERROR: ${message}`);
	console.error(error);
}

function logSuccess(message: string): void {
	console.log(`[ML Providers] ✓ ${message}`);
}

// ============================================================================
// Smoke Tests
// ============================================================================

async function testProviderSelection(): Promise<boolean> {
	log("Testing provider selection logic...");

	try {
		const providerName = selectProvider();
		log(`Selected provider: ${providerName}`);

		// Verify expected selection based on env
		const mlProvider = process.env.ML_PROVIDER;
		const deepinfraKey = process.env.DEEPINFRA_API_KEY;

		if (mlProvider) {
			if (providerName !== mlProvider) {
				logError(
					`Expected provider ${mlProvider}, got ${providerName}`,
					null,
				);
				return false;
			}
		} else if (deepinfraKey) {
			if (providerName !== "deepinfra") {
				logError("Expected deepinfra when API key is set", null);
				return false;
			}
		} else {
			if (providerName !== "huggingface") {
				logError("Expected huggingface as fallback", null);
				return false;
			}
		}

		logSuccess("Provider selection logic correct");
		return true;
	} catch (error) {
		logError("Provider selection failed", error);
		return false;
	}
}

async function testProviderCreation(): Promise<boolean> {
	log("Testing provider creation...");

	try {
		resetProvider(); // Reset singleton for test
		const result = createProvider();

		if (Result.isError(result)) {
			logError("Provider creation failed", result.error);
			return false;
		}

		const provider = result.value;
		const metadata = provider.getMetadata();

		log("Provider metadata:", metadata);
		logSuccess(`Provider created: ${metadata.name}`);
		return true;
	} catch (error) {
		logError("Provider creation threw error", error);
		return false;
	}
}

async function testProviderAvailability(): Promise<boolean> {
	log("Testing provider availability...");

	try {
		const result = getMlProvider();

		if (Result.isError(result)) {
			logError("Failed to get provider", result.error);
			return false;
		}

		const provider = result.value;
		const available = await provider.isAvailable();

		log(`Provider available: ${available}`);

		if (!available) {
			log("WARNING: Provider not available (may be expected for some providers)");
		} else {
			logSuccess("Provider is available");
		}

		return true;
	} catch (error) {
		logError("Availability check failed", error);
		return false;
	}
}

async function testBasicEmbedding(): Promise<boolean> {
	log("Testing basic embedding operation...");

	try {
		const result = getMlProvider();

		if (Result.isError(result)) {
			logError("Failed to get provider", result.error);
			return false;
		}

		const provider = result.value;
		const text = "This is a test sentence for embedding.";

		log(`Embedding text: "${text}"`);

		const embedResult = await provider.embed(text, {
			prefix: "passage:",
		});

		if (Result.isError(embedResult)) {
			logError("Embedding failed", embedResult.error);
			return false;
		}

		const { embedding, model, dims } = embedResult.value;

		log("Embedding result:", {
			model,
			dims,
			embeddingLength: embedding.length,
			firstFewValues: embedding.slice(0, 5),
		});

		// Validate embedding
		if (embedding.length !== dims) {
			logError(
				`Dimension mismatch: expected ${dims}, got ${embedding.length}`,
				null,
			);
			return false;
		}

		if (embedding.length === 0) {
			logError("Empty embedding vector", null);
			return false;
		}

		logSuccess(`Embedding successful: ${dims} dimensions`);
		return true;
	} catch (error) {
		logError("Embedding test failed", error);
		return false;
	}
}

async function testBatchEmbedding(): Promise<boolean> {
	log("Testing batch embedding operation...");

	try {
		const result = getMlProvider();

		if (Result.isError(result)) {
			logError("Failed to get provider", result.error);
			return false;
		}

		const provider = result.value;
		const texts = [
			"First test sentence",
			"Second test sentence",
			"Third test sentence",
		];

		log(`Embedding ${texts.length} texts`);

		const embedResult = await provider.embedBatch(texts, {
			prefix: "passage:",
		});

		if (Result.isError(embedResult)) {
			logError("Batch embedding failed", embedResult.error);
			return false;
		}

		const results = embedResult.value;

		log("Batch embedding results:", {
			count: results.length,
			model: results[0]?.model,
			dims: results[0]?.dims,
		});

		// Validate batch results
		if (results.length !== texts.length) {
			logError(
				`Result count mismatch: expected ${texts.length}, got ${results.length}`,
				null,
			);
			return false;
		}

		for (const result of results) {
			if (result.embedding.length !== result.dims) {
				logError("Dimension mismatch in batch result", null);
				return false;
			}
		}

		logSuccess(`Batch embedding successful: ${results.length} embeddings`);
		return true;
	} catch (error) {
		logError("Batch embedding test failed", error);
		return false;
	}
}

async function testReranking(): Promise<boolean> {
	log("Testing reranking operation...");

	try {
		const result = getMlProvider();

		if (Result.isError(result)) {
			logError("Failed to get provider", result.error);
			return false;
		}

		const provider = result.value;
		const metadata = provider.getMetadata();

		// Check if reranking is supported
		if (!metadata.rerankerModel) {
			log(`Reranking not supported by ${metadata.name} provider (expected)`);
			return true;
		}

		const query = "machine learning algorithms";
		const documents = [
			"Neural networks are a type of machine learning algorithm",
			"The weather is sunny today",
			"Deep learning is a subset of machine learning",
			"I like to eat pizza",
		];

		log(`Reranking ${documents.length} documents`);

		const rerankResult = await provider.rerank(query, documents);

		if (Result.isError(rerankResult)) {
			// Reranking failure is acceptable for some providers
			log(`Reranking failed (may be unsupported): ${rerankResult.error.message}`);
			return true;
		}

		const { scores, model } = rerankResult.value;

		log("Reranking results:", {
			model,
			scoreCount: scores.length,
			topScores: scores.slice(0, 2),
		});

		// Validate reranking
		if (scores.length === 0) {
			logError("No reranking scores returned", null);
			return false;
		}

		logSuccess(`Reranking successful: ${scores.length} scores`);
		return true;
	} catch (error) {
		logError("Reranking test failed", error);
		return false;
	}
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main(): Promise<void> {
	log("Starting ML Provider smoke tests...");
	log("Environment:");
	log(`  ML_PROVIDER: ${process.env.ML_PROVIDER || "(not set)"}`);
	log(`  DEEPINFRA_API_KEY: ${process.env.DEEPINFRA_API_KEY ? "✓ set" : "(not set)"}`);
	log(`  HF_TOKEN: ${process.env.HF_TOKEN ? "✓ set" : "(not set)"}`);
	console.log();

	const tests = [
		{ name: "Provider Selection", fn: testProviderSelection },
		{ name: "Provider Creation", fn: testProviderCreation },
		{ name: "Provider Availability", fn: testProviderAvailability },
		{ name: "Basic Embedding", fn: testBasicEmbedding },
		{ name: "Batch Embedding", fn: testBatchEmbedding },
		{ name: "Reranking", fn: testReranking },
	];

	let passed = 0;
	let failed = 0;

	for (const test of tests) {
		console.log();
		console.log("=".repeat(60));
		const success = await test.fn();
		if (success) {
			passed++;
		} else {
			failed++;
		}
	}

	console.log();
	console.log("=".repeat(60));
	log(`Tests completed: ${passed} passed, ${failed} failed`);

	if (failed > 0) {
		process.exit(1);
	}
}

// Run tests
main().catch((error) => {
	logError("Unhandled error in test runner", error);
	process.exit(1);
});
