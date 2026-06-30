/**
 * Server functions backing durable (DB) consent for authenticated users.
 *
 * - getInitialConsentState: optional auth. Read on the root loader so the
 *   provider can decide server-side and avoid a banner flash for logged-in
 *   users whose cookie is gone but DB consent is still valid.
 * - persistConsentDecision: requires auth. Upserts the decision as the durable
 *   source of truth.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import {
	CURRENT_CONSENT_VERSION,
	type ResolvedConsent,
} from "@/lib/consent/consent-policy";
import {
	resolveStoredConsent,
	saveConsentPreference,
} from "@/lib/domains/library/accounts/preferences-queries";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { getAuthSession } from "@/lib/platform/auth/auth.server";

export interface InitialConsentState {
	isAuthenticated: boolean;
	// null for anonymous users — their only source of truth is the cookie, read
	// client-side. Populated for authenticated users from the DB.
	consent: ResolvedConsent | null;
}

export const getInitialConsentState = createServerFn({ method: "GET" }).handler(
	async (): Promise<InitialConsentState> => {
		const auth = await getAuthSession();

		if (!auth) {
			return { isAuthenticated: false, consent: null };
		}

		const result = await resolveStoredConsent(auth.session.accountId);

		// Fail safe: if the read errors, treat as "absent" rather than assume a
		// consent we couldn't verify. Worst case the user is re-asked.
		const consent: ResolvedConsent = Result.isOk(result)
			? result.value
			: { state: "absent" };

		return { isAuthenticated: true, consent };
	},
);

const consentDecisionInput = z.object({
	status: z.enum(["granted", "denied"]),
});

export const persistConsentDecision = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(consentDecisionInput)
	.handler(async ({ data, context }): Promise<{ success: true }> => {
		const result = await saveConsentPreference(
			context.session.accountId,
			data.status,
			CURRENT_CONSENT_VERSION,
		);

		if (Result.isError(result)) {
			console.error("[consent] Failed to persist consent decision", {
				accountId: context.session.accountId,
				status: data.status,
				error: result.error,
			});
			// console.error never reaches Sentry with enableLogs:false; capture explicitly
			captureServerError(result.error, {
				area: "consent",
				operation: "persist_consent_decision",
				accountId: context.session.accountId,
			});
			throw new Error("Failed to persist consent decision");
		}

		return { success: true };
	});
