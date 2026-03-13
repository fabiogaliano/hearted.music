import type { LlmProviderName } from "./service";

/**
 * Resolves API key for a provider from environment variables.
 * Google uses a fallback chain matching Vercel AI SDK conventions.
 */
export function getApiKeyForProvider(
	provider: LlmProviderName,
): string | undefined {
	switch (provider) {
		case "google":
			return (
				process.env.GEMINI_API_KEY ??
				process.env.GOOGLE_GENERATIVE_AI_API_KEY ??
				process.env.GOOGLE_API_KEY
			);
		case "anthropic":
			return process.env.ANTHROPIC_API_KEY;
		case "openai":
			return process.env.OPENAI_API_KEY;
	}
}
