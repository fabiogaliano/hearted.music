/**
 * ML Provider Factory - creates the provider named by ML_PROVIDER.
 */

import { Result } from "better-result";
import { env } from "@/env";
import {
	MLConfigError,
	type MLProviderUnavailableError,
} from "@/lib/shared/errors/domain/ml";
import { createDeepInfraProvider } from "./adapters/deepinfra";
import { createHuggingFaceProvider } from "./adapters/huggingface";
import { createLocalProvider } from "./adapters/local";
import type { MLProvider } from "./ports";

/**
 * Creates an ML provider instance based on environment configuration.
 *
 * @returns Result containing provider instance or configuration error
 */
export function createProvider(): Result<
	MLProvider,
	MLConfigError | MLProviderUnavailableError
> {
	const providerName = env.ML_PROVIDER;

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
