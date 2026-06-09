/**
 * Server functions for handle availability and claiming.
 *
 * Kept separate from onboarding.functions.ts because handle claiming is
 * reused identity infrastructure; it should not grow the onboarding module.
 *
 * Expected business outcomes are returned as typed values.
 * Only operational failures throw.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { isProfaneHandle } from "@/lib/domains/library/accounts/handle-profanity";
import {
	type HandleValidationReason,
	isReservedHandle,
	validateHandleFormatInput,
} from "@/lib/domains/library/accounts/handle-rules";
import type { OnboardingAuthPayload } from "@/lib/domains/library/accounts/onboarding-session";
import { isOnboardingStepBefore } from "@/lib/domains/library/accounts/onboarding-steps";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { loadOnboardingSession } from "@/lib/server/onboarding-session";

// Transport-only shape — no business validation here.
// Format rules, reserved-word checks, and profanity belong in the domain layer
// so the server can return typed reason values rather than schema errors.
const handleInputSchema = z.object({
	handle: z.string(),
});

// The generated claim_handle Returns type declares owned_handle as string
// (non-null), but the not_ready branch returns NULL at runtime — the Supabase
// CLI reads the RETURNS TABLE column declaration, not the actual branch returns.
// We cast to unknown so the z.null() branch can validate the real runtime value.
const claimHandleRpcRowSchema = z.union([
	z.object({
		status: z.literal("claimed"),
		owned_handle: z.string(),
	}),
	z.object({
		status: z.literal("already_owned"),
		owned_handle: z.string(),
	}),
	z.object({
		status: z.literal("not_ready"),
		owned_handle: z.null(),
	}),
]);

export type CheckHandleAvailabilityResult =
	| { status: "available" }
	| {
			status: "already_owned";
			ownedHandle: string;
			onboarding: OnboardingAuthPayload;
	  }
	| { status: "unavailable"; reason: HandleValidationReason }
	| { status: "error" };

export type ClaimHandleAndAdvanceResult =
	| {
			status: "claimed";
			ownedHandle: string;
			onboarding: OnboardingAuthPayload;
	  }
	| { status: "not_ready"; onboarding: OnboardingAuthPayload }
	| {
			status: "already_owned";
			ownedHandle: string;
			onboarding: OnboardingAuthPayload;
	  }
	| { status: "unavailable"; reason: HandleValidationReason };

/**
 * Read-only check: is the submitted handle available for this account?
 *
 * Self-owned exact match bypasses reserved/profanity/taken intentionally —
 * an immutable handle is grandfathered so the user is never stranded with
 * no rename path if a later policy change would block the same string.
 *
 * Operational failures (DB, payload build) are caught and returned as
 * `{ status: "error" }` so the UI can block Continue without a crash.
 */
export const checkHandleAvailability = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator(handleInputSchema)
	.handler(
		async ({ data, context }): Promise<CheckHandleAvailabilityResult> => {
			const { session: authSession, account } = context;
			const accountId = authSession.accountId;

			try {
				// Lowercase without trim — leading/trailing whitespace becomes invalid_chars,
				// giving the client a specific error rather than silently succeeding.
				const formatResult = validateHandleFormatInput(data.handle);
				if (formatResult.status === "invalid") {
					return { status: "unavailable", reason: formatResult.reason };
				}
				const { normalizedHandle } = formatResult;

				// Self-owned exact match: available immediately, no further checks needed.
				if (account.handle !== null) {
					if (account.handle === normalizedHandle) {
						return { status: "available" };
					}
					// Account already owns a different handle — recovery payload for stale-tab correction.
					const onboarding = await loadOnboardingSession({
						accountId,
						accountHandle: account.handle,
					});
					return {
						status: "already_owned",
						ownedHandle: account.handle,
						onboarding,
					};
				}

				if (isReservedHandle(normalizedHandle)) {
					return { status: "unavailable", reason: "reserved" };
				}

				if (isProfaneHandle(normalizedHandle)) {
					return { status: "unavailable", reason: "profanity" };
				}

				// Plain equality on the canonical handle column, excluding self so the
				// pre-RPC check can't falsely block a re-entry for the same account.
				const supabase = createAdminSupabaseClient();
				const { data: takenRow, error: takenError } = await supabase
					.from("account")
					.select("id")
					.eq("handle", normalizedHandle)
					.neq("id", accountId)
					.limit(1)
					.maybeSingle();

				if (takenError) {
					console.error(
						"[checkHandleAvailability] DB lookup failed:",
						takenError,
					);
					return { status: "error" };
				}

				if (takenRow) {
					return { status: "unavailable", reason: "taken" };
				}

				return { status: "available" };
			} catch (err) {
				console.error("[checkHandleAvailability] Unexpected failure:", err);
				return { status: "error" };
			}
		},
	);

/**
 * Mutating claim: reserve the handle and advance onboarding to flag-playlists.
 *
 * Idempotent for the same-handle re-entry path: if the account already owns
 * exactly this handle, reserved/profanity/taken checks are skipped so a stale
 * tab can re-confirm without being blocked by a policy change.
 *
 * The returned `ownedHandle` and `onboarding` are derived from the RPC's
 * authoritative result row, NOT from the stale middleware context, so the
 * client cache is always consistent.
 */
export const claimHandleAndAdvance = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator(handleInputSchema)
	.handler(async ({ data, context }): Promise<ClaimHandleAndAdvanceResult> => {
		const { session: authSession, account } = context;
		const accountId = authSession.accountId;

		// Lowercase without trim — whitespace returns invalid_chars before any
		// already_owned check, matching checkHandleAvailability semantics.
		const formatResult = validateHandleFormatInput(data.handle);
		if (formatResult.status === "invalid") {
			return { status: "unavailable", reason: formatResult.reason };
		}
		const { normalizedHandle } = formatResult;

		// Account already has a handle.
		if (account.handle !== null) {
			if (account.handle !== normalizedHandle) {
				// Different handle — can't claim; return recovery payload.
				const onboarding = await loadOnboardingSession({
					accountId,
					accountHandle: account.handle,
				});
				return {
					status: "already_owned",
					ownedHandle: account.handle,
					onboarding,
				};
			}
			// Same handle — idempotent path falls through to RPC without
			// reserved/profanity/taken checks (grandfathered, see header comment).
		} else {
			// No handle yet — check whether the account is far enough in onboarding.
			const currentOnboarding = await loadOnboardingSession({
				accountId,
				accountHandle: null,
			});

			// isOnboardingStepBefore uses the authoritative ONBOARDING_STEP_VALUES
			// ordering so adding steps never silently changes this gate.
			const currentStep = currentOnboarding.session.status;
			if (
				currentStep !== "complete" &&
				isOnboardingStepBefore(currentStep, "claim-handle")
			) {
				// Expected state mismatch — the client should navigate from the returned
				// session instead of guessing a destination.
				return { status: "not_ready", onboarding: currentOnboarding };
			}

			// First-claim path: run reserved/profanity checks before hitting the DB.
			if (isReservedHandle(normalizedHandle)) {
				return { status: "unavailable", reason: "reserved" };
			}

			if (isProfaneHandle(normalizedHandle)) {
				return { status: "unavailable", reason: "profanity" };
			}
		}

		const supabase = createAdminSupabaseClient();
		const rpcResult = await supabase
			.rpc("claim_handle", {
				p_account_id: accountId,
				p_handle: normalizedHandle,
			})
			.single();

		if (rpcResult.error) {
			// Unique-constraint violation: another account claimed this handle first.
			if (rpcResult.error.code === "23505") {
				return { status: "unavailable", reason: "taken" };
			}
			// Any other DB/transport failure is operational — let it surface as a toast.
			throw rpcResult.error;
		}

		// Cast to unknown so the z.null() branch can validate the not_ready row
		// where owned_handle is actually NULL despite the generated type saying string.
		const row = claimHandleRpcRowSchema.parse(rpcResult.data as unknown);

		if (row.status === "claimed") {
			const onboarding = await loadOnboardingSession({
				accountId,
				accountHandle: row.owned_handle,
			});
			return { status: "claimed", ownedHandle: row.owned_handle, onboarding };
		}

		if (row.status === "already_owned") {
			const onboarding = await loadOnboardingSession({
				accountId,
				accountHandle: row.owned_handle,
			});
			return {
				status: "already_owned",
				ownedHandle: row.owned_handle,
				onboarding,
			};
		}

		// not_ready: DB says the account isn't ready to claim (step too early).
		const onboarding = await loadOnboardingSession({
			accountId,
			accountHandle: null,
		});
		return { status: "not_ready", onboarding };
	});
