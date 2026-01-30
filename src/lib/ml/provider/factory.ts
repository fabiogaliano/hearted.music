/**
 * ML Provider Factory - Selects and creates ML providers based on environment configuration.
 *
 * Selection Logic (Priority Order):
 * 1. If ML_PROVIDER is explicitly set, use that provider (explicit override)
 * 2. Otherwise, if DEEPINFRA_API_KEY exists, use DeepInfra (default production)
 * 3. Otherwise, use HuggingFace (default development/fallback)
 *
 * This enables:
 * - Explicit provider selection via ML_PROVIDER env var
 * - Automatic DeepInfra selection when API key is configured
 * - Graceful fallback to HuggingFace free tier
 * - Local development with ML_PROVIDER=local
 */

import { Result } from "better-result";
import { env } from "@/env";
import {
	MLConfigError,
	type MLProviderUnavailableError,
} from "@/lib/shared/errors/domain/ml";
import type { MLProvider } from "./ports";
import type { ProviderName } from "./types";
import { createDeepInfraProvider } from "../adapters/deepinfra";
import { createHuggingFaceProvider } from "../adapters/huggingface";
import { createLocalProvider } from "../adapters/local";

/**
 * Determines which ML provider to use based on environment configuration.
 *
 * Priority order:
 * 1. ML_PROVIDER env var (explicit override)
 * 2. DeepInfra if DEEPINFRA_API_KEY exists
 * 3. HuggingFace (fallback)
 *
 * @returns Provider name to use
 */
export function selectProvider(): ProviderName {
	// Explicit override via ML_PROVIDER
	if (env.ML_PROVIDER) {
		return env.ML_PROVIDER;
	}

	// Default to DeepInfra if API key is configured
	if (env.DEEPINFRA_API_KEY) {
		return "deepinfra";
	}

	// Fallback to HuggingFace (free tier)
	return "huggingface";
}

/**
 * Creates an ML provider instance based on environment configuration.
 *
 * @returns Result containing provider instance or configuration error
 */
export function createProvider(): Result<
	MLProvider,
	MLConfigError | MLProviderUnavailableError
> {
	const providerName = selectProvider();

	switch (providerName) {
		case "deepinfra": {
			const result = createDeepInfraProvider();
			if (Result.isError(result)) {
				return Result.err(result.error);
			}
			return Result.ok(result.value);
		}

		case "huggingface": {
			return Result.ok(createHuggingFaceProvider());
		}

		case "local": {
			const result = createLocalProvider();
			if (Result.isError(result)) {
				return Result.err(result.error);
			}
			return Result.ok(result.value);
		}

		default: {
			// TypeScript exhaustiveness check
			const _exhaustive: never = providerName;
			return Result.err(
				new MLConfigError(
					"factory",
					"ML_PROVIDER",
					`Unknown provider: ${_exhaustive}`,
				),
			);
		}
	}
}

/**
 * Lazy singleton instance of the ML provider.
 */
let providerInstance: MLProvider | null = null;

/**
 * Gets the ML provider instance (lazy singleton).
 *
 * Creates the provider on first call and reuses it for subsequent calls.
 * This ensures a single provider instance is shared across the application.
 *
 * @returns Result containing provider instance or error
 */
export function getMlProvider(): Result<
	MLProvider,
	MLConfigError | MLProviderUnavailableError
> {
	if (providerInstance) {
		return Result.ok(providerInstance);
	}

	const result = createProvider();

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	providerInstance = result.value;
	return Result.ok(providerInstance);
}

/**
 * Resets the provider singleton (for testing).
 */
export function resetProvider(): void {
	providerInstance = null;
}
