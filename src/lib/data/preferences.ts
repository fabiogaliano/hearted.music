/**
 * User preferences data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { z } from "zod";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Enums, Tables } from "./database.types";

export type UserPreferences = Tables<"user_preferences">;

/**
 * User's persisted theme preference.
 * null = user hasn't chosen a theme yet (only during onboarding)
 * Non-null = user's explicit choice
 */
export type UserThemePreference = Enums<"theme"> | null;

export const ACCOUNT_ID_SCHEMA = z.uuid();

export const ONBOARDING_STEPS = z.enum([
	"welcome",
	"pick-color",
	"connecting",
	"syncing",
	"flag-playlists",
	"ready",
	"complete",
]);

export type OnboardingStep = z.infer<typeof ONBOARDING_STEPS>;

/**
 * Gets preferences for an account.
 * Returns null if no preferences record exists (use getOrCreatePreferences for auto-creation).
 */
export function getPreferences(
	accountId: string,
): Promise<Result<UserPreferences | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseMaybe(
		supabase
			.from("user_preferences")
			.select("*")
			.eq("account_id", accountId)
			.single(),
	);
}

/**
 * Gets or creates preferences for an account.
 * If no record exists, creates one with defaults (theme: null, onboarding_step: welcome).
 * Note: theme is null until user explicitly chooses one during onboarding.
 *
 * IMPORTANT: Will fail with ConstraintError if account_id doesn't exist in the account table.
 * This can happen when:
 * - Database was reset (dev environment)
 * - Account was deleted
 * - Session cookie references a non-existent account (orphaned session)
 *
 * Callers should handle ConstraintError gracefully by clearing the invalid session.
 */
export async function getOrCreatePreferences(
	accountId: string,
): Promise<Result<UserPreferences, DbError>> {
	const existing = await getPreferences(accountId);

	if (Result.isOk(existing) && existing.value !== null) {
		return Result.ok(existing.value);
	}

	// If not found, create new preferences
	// This will fail with ConstraintError if account doesn't exist (foreign key violation)
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.insert({
				account_id: accountId,
				// theme is intentionally omitted - starts as null
				onboarding_step: ONBOARDING_STEPS.enum.welcome,
			})
			.select()
			.single(),
	);
}

/**
 * Gets the current onboarding step for an account.
 * Returns 'welcome' if no preferences exist.
 * Validates the step using Zod instead of type assertion.
 */
export async function getOnboardingStep(
	accountId: string,
): Promise<Result<OnboardingStep, DbError>> {
	const result = await getPreferences(accountId);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	const stepValidation = ONBOARDING_STEPS.safeParse(
		result.value?.onboarding_step,
	);

	return Result.ok(
		stepValidation.success
			? stepValidation.data
			: ONBOARDING_STEPS.enum.welcome,
	);
}

export async function isOnboardingComplete(
	accountId: string,
): Promise<Result<boolean, DbError>> {
	const result = await getPreferences(accountId);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(result.value?.onboarding_completed_at !== null);
}

/**
 * Updates the theme for an account.
 * Creates a preferences record if one doesn't exist.
 * @param theme Theme color, or null to clear (for reset/dev purposes)
 */
export function updateTheme(
	accountId: string,
	theme: Enums<"theme"> | null,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.upsert(
				{
					account_id: accountId,
					theme,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}

export function updateOnboardingStep(
	accountId: string,
	step: OnboardingStep,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.upsert(
				{
					account_id: accountId,
					onboarding_step: step,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}

export function completeOnboarding(
	accountId: string,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	const now = new Date().toISOString();

	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.upsert(
				{
					account_id: accountId,
					onboarding_completed_at: now,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}

export function resetOnboarding(
	accountId: string,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.upsert(
				{
					account_id: accountId,
					onboarding_step: ONBOARDING_STEPS.enum.welcome,
					onboarding_completed_at: null,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}

/**
 * Updates the phase job IDs for an account.
 * Called after creating sync jobs to enable refresh resilience.
 */
export function updatePhaseJobIds(
	accountId: string,
	phaseJobIds: PhaseJobIds,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.update({ phase_job_ids: phaseJobIds })
			.eq("account_id", accountId)
			.select()
			.single(),
	);
}

/**
 * Clears the phase job IDs for an account.
 * Called when sync completes or user advances past syncing step.
 */
export function clearPhaseJobIds(
	accountId: string,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.update({ phase_job_ids: null })
			.eq("account_id", accountId)
			.select()
			.single(),
	);
}

export async function getPhaseJobIds(
	accountId: string,
): Promise<Result<PhaseJobIds | null, DbError>> {
	const result = await getPreferences(accountId);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	if (!result.value?.phase_job_ids) {
		return Result.ok(null);
	}

	const { PhaseJobIdsSchema } = await import("@/lib/jobs/progress/types");
	const parsed = PhaseJobIdsSchema.safeParse(result.value.phase_job_ids);

	return Result.ok(parsed.success ? parsed.data : null);
}
