/**
 * Onboarding flow error types.
 */

import { TaggedError } from "better-result";
import type { DbError } from "../database";
import type { SpotifyServiceError } from "@/lib/integrations/spotify";

/** All possible onboarding error causes */
export type OnboardingErrorCause = DbError | SpotifyServiceError | Error;

/** Onboarding operation failed */
export class OnboardingError extends TaggedError("OnboardingError")<{
	operation: string;
	cause: OnboardingErrorCause;
	message: string;
}>() {
	constructor(operation: string, cause: OnboardingErrorCause) {
		const tag = "_tag" in cause ? cause._tag : cause.name;
		super({
			operation,
			cause,
			message: `Onboarding operation failed: ${operation} (${tag})`,
		});
	}
}

export type OnboardingFlowError = OnboardingError;
