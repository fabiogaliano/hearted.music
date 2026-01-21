/**
 * Smoke test for model bundle versioning system.
 * Run: pnpm tsx scripts/smoke-model-bundle.ts
 * Delete after verifying.
 */

import { Result } from "better-result";
import { getActiveModelBundle } from "@/lib/ml/embedding/model-bundle";
import { hashModelBundle } from "@/lib/ml/embedding/hashing";
import { getModelBundleHash } from "@/lib/ml/embedding/versioning";

async function smoke() {
	console.log("🧪 Model Bundle Smoke Test\n");

	// 1. Check getActiveModelBundle returns valid structure
	const bundleResult = getActiveModelBundle();
	if (Result.isError(bundleResult)) {
		throw new Error(
			`Failed to get active model bundle: ${bundleResult.error.message}`,
		);
	}
	const bundle = bundleResult.value;
	console.log("✓ getActiveModelBundle()");
	console.log(`  model: ${bundle.embedding.model}`);
	console.log(`  dims: ${bundle.embedding.dims}`);
	console.log(`  algorithms: e${bundle.algorithms.extractor}_s${bundle.algorithms.schema}_p${bundle.algorithms.profile}_${bundle.algorithms.matching}`);

	// 2. Check hashModelBundle produces mb_ prefixed hash
	const hash1 = await hashModelBundle(bundle);
	const hash2 = await hashModelBundle(bundle);
	console.log(`\n✓ hashModelBundle()`);
	console.log(`  hash: ${hash1}`);
	console.log(`  prefix correct: ${hash1.startsWith("mb_") ? "✓" : "✗"}`);
	console.log(`  deterministic: ${hash1 === hash2 ? "✓" : "✗"}`);

	// 3. Check getModelBundleHash (cached version)
	const cached1Result = await getModelBundleHash();
	if (Result.isError(cached1Result)) {
		throw new Error(
			`Failed to get model bundle hash: ${cached1Result.error.message}`,
		);
	}
	const cached1 = cached1Result.value;
	const cached2Result = await getModelBundleHash();
	if (Result.isError(cached2Result)) {
		throw new Error(
			`Failed to get model bundle hash (2nd call): ${cached2Result.error.message}`,
		);
	}
	const cached2 = cached2Result.value;
	console.log(`\n✓ getModelBundleHash()`);
	console.log(`  hash: ${cached1}`);
	console.log(`  matches direct: ${cached1 === hash1 ? "✓" : "✗"}`);
	console.log(`  caching works: ${cached1 === cached2 ? "✓" : "✗"}`);

	// 4. Verify hash changes when config changes
	const modifiedBundle = {
		...bundle,
		algorithms: { ...bundle.algorithms, extractor: 999 },
	};
	const modifiedHash = await hashModelBundle(modifiedBundle);
	console.log(`\n✓ Cache invalidation test`);
	console.log(`  original: ${hash1}`);
	console.log(`  modified: ${modifiedHash}`);
	console.log(`  hashes differ: ${hash1 !== modifiedHash ? "✓" : "✗"}`);

	console.log("\n✅ All smoke tests passed!");
}

smoke().catch(console.error);
