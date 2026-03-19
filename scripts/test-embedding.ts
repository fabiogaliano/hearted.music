/**
 * Disposable script to test the ML embedding provider.
 * Usage: bun scripts/test-embedding.ts
 */

import { selectProvider, createProvider } from "@/lib/integrations/providers/factory";
import { Result } from "better-result";

const provider = selectProvider();
console.log(`ML_PROVIDER resolved to: ${provider}`);

const result = createProvider();
if (Result.isError(result)) {
	console.error("Failed to create provider:", result.error);
	process.exit(1);
}

const ml = result.value;
console.log(`Provider: ${ml.getMetadata().name}, model: ${ml.getMetadata().embeddingModel}`);

console.log("Embedding test text...");
const embedResult = await ml.embed("This is a test sentence about indie rock music.");

if (Result.isError(embedResult)) {
	console.error("Embed failed:", embedResult.error);
	process.exit(1);
}

console.log(`Status: OK`);
console.log(`Dimensions: ${embedResult.value.embedding.length}`);
console.log(`First 5 values: [${embedResult.value.embedding.slice(0, 5).map(v => v.toFixed(4)).join(", ")}]`);
