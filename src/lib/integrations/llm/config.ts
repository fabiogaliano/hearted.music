import { env } from "@/env";
import type { LlmProviderName } from "./service";

/**
 * Resolves API key for a provider from the validated env schema.
 * Google uses a fallback chain matching Vercel AI SDK conventions.
 */
export function getApiKeyForProvider(
	provider: LlmProviderName,
): string | undefined {
	switch (provider) {
		case "google":
			return (
				env.GEMINI_API_KEY ??
				env.GOOGLE_GENERATIVE_AI_API_KEY ??
				env.GOOGLE_API_KEY
			);
		case "anthropic":
			return env.ANTHROPIC_API_KEY;
		case "openai":
			return env.OPENAI_API_KEY;
	}
}
