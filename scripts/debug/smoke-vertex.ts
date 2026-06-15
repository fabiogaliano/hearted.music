/**
 * Smoke test for the Vertex AI transport. Confirms the wired-up LlmService can
 * reach Gemini on Vertex using Application Default Credentials, billing the GCP
 * project (and thus drawing Cloud credits).
 *
 * Prerequisites:
 *   gcloud auth application-default login --project=hearted-492606
 *   GOOGLE_VERTEX_PROJECT set in .env (already configured)
 *
 * Run: bun scripts/debug/smoke-vertex.ts
 */

import { Result } from "better-result";
import { createLlmService } from "@/lib/integrations/llm/service";

async function main() {
	const llm = createLlmService("google-vertex");
	console.log(`provider/model: ${llm.getCurrentModel()}`);

	const result = await llm.generateText("Reply with exactly one word: hello", {
		maxOutputTokens: 512,
	});

	if (Result.isError(result)) {
		console.error("Vertex call failed:", result.error.message);
		process.exit(1);
	}

	console.log("response:", result.value.text.trim());
	console.log("tokens:", result.value.tokens);
}

main();
