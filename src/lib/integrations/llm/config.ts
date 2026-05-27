import type { CredentialBody } from "google-auth-library";
import { env } from "@/env";
import type { LlmConfig, LlmProviderName } from "./service";

/**
 * App-wide default LLM transport. Vertex bills the GCP project (drawing Cloud
 * credits) and authenticates via ADC; the AI Studio `google` path remains for
 * scripts/experiments that pass an explicit provider.
 */
export const DEFAULT_LLM_PROVIDER: LlmProviderName = "google-vertex";

/**
 * Resolves the API key for a key-based provider from the validated env schema.
 * Google uses a fallback chain matching Vercel AI SDK conventions. Vertex is
 * keyless, so it has no key to return.
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
		case "google-vertex":
			return undefined;
	}
}

export type LlmConfigResolution =
	| { ok: true; config: LlmConfig }
	| { ok: false; reason: string };

/**
 * Resolves a complete LlmConfig from environment, or an explanation when the
 * provider isn't configured. Callers map the failure to their own error type so
 * analysis degrades gracefully when a provider is unset.
 */
export function resolveLlmConfig(
	provider: LlmProviderName,
): LlmConfigResolution {
	if (provider === "google-vertex") {
		const project = env.GOOGLE_VERTEX_PROJECT;
		if (!project) {
			return {
				ok: false,
				reason:
					"Vertex AI is not configured. Set GOOGLE_VERTEX_PROJECT and authenticate via ADC.",
			};
		}
		const credentialsResult = parseVertexCredentials();
		if (!credentialsResult.ok) {
			return credentialsResult;
		}
		return {
			ok: true,
			config: {
				provider,
				project,
				location: env.GOOGLE_VERTEX_LOCATION ?? "us-central1",
				credentials: credentialsResult.credentials,
			},
		};
	}

	const apiKey = getApiKeyForProvider(provider);
	if (!apiKey || apiKey.trim() === "") {
		return { ok: false, reason: `Missing API key for provider: ${provider}.` };
	}
	return { ok: true, config: { provider, apiKey } };
}

/**
 * Container deploys (Coolify) can't mount a key file, so the service-account
 * JSON is passed inline via env. Locally the var is unset and google-auth-library
 * falls back to ADC (GOOGLE_APPLICATION_CREDENTIALS or
 * `gcloud auth application-default login`).
 */
function parseVertexCredentials():
	| { ok: true; credentials?: CredentialBody }
	| { ok: false; reason: string } {
	const raw = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
	if (!raw) return { ok: true };
	try {
		return { ok: true, credentials: JSON.parse(raw) as CredentialBody };
	} catch {
		return {
			ok: false,
			reason:
				"GOOGLE_APPLICATION_CREDENTIALS_JSON is set but is not valid JSON.",
		};
	}
}
