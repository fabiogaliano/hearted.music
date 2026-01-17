/**
 * User preferences data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/errors/data";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/utils/result-wrappers/supabase";
import { createAdminSupabaseClient } from "./client";
import type { Enums, Tables } from "./database.types";

// ============================================================================
// Type Exports
// ============================================================================

/** User preferences row type */
export type UserPreferences = Tables<"user_preferences">;

/** Theme color enum from database */
export type ThemeColor = Enums<"theme">;

/** Onboarding step (0 = not started, 1-N = step number) */
export type OnboardingStep = number;

// ============================================================================
// Query Operations
// ============================================================================

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
 * If no record exists, creates one with defaults (theme: blue, onboarding_step: 0).
 */
export async function getOrCreatePreferences(
	accountId: string,
): Promise<Result<UserPreferences, DbError>> {
	const existing = await getPreferences(accountId);

	if (Result.isError(existing)) {
		return Result.err(existing.error);
	}

	if (existing.value !== null) {
		return Result.ok(existing.value);
	}

	// Create with defaults
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.insert({
				account_id: accountId,
				theme: "blue",
				onboarding_step: 0,
			})
			.select()
			.single(),
	);
}

/**
 * Gets the current onboarding step for an account.
 * Returns 0 if no preferences exist.
 */
export async function getOnboardingStep(
	accountId: string,
): Promise<Result<OnboardingStep, DbError>> {
	const result = await getPreferences(accountId);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(result.value?.onboarding_step ?? 0);
}

/**
 * Checks if onboarding is complete for an account.
 */
export async function isOnboardingComplete(
	accountId: string,
): Promise<Result<boolean, DbError>> {
	const result = await getPreferences(accountId);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	return Result.ok(result.value?.onboarding_completed_at !== null);
}

// ============================================================================
// Mutation Operations
// ============================================================================

/**
 * Updates the theme for an account.
 * Creates a preferences record if one doesn't exist.
 */
export function updateTheme(
	accountId: string,
	theme: ThemeColor,
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

/**
 * Updates the onboarding step for an account.
 * Creates a preferences record if one doesn't exist.
 */
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

/**
 * Marks onboarding as complete for an account.
 * Sets onboarding_completed_at to the current timestamp.
 */
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

/**
 * Resets onboarding for an account.
 * Sets onboarding_step to 0 and clears onboarding_completed_at.
 */
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
					onboarding_step: 0,
					onboarding_completed_at: null,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}
