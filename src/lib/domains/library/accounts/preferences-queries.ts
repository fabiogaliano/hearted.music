/**
 * User preferences data operations.
 *
 * Uses service role client to bypass RLS since we use custom auth.
 * Returns Result<T, DbError> for composable error handling.
 */

import { Result } from "better-result";
import { z } from "zod";
import {
	evaluateStoredConsent,
	type ResolvedConsent,
} from "@/lib/consent/consent-policy";
import type { ConsentStatus } from "@/lib/consent/consent-storage";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Enums, Tables } from "@/lib/data/database.types";
import {
	DEFAULT_ONBOARDING_STEP,
	ONBOARDING_STEP_VALUES,
	type OnboardingStep,
	SAVEABLE_ONBOARDING_STEP_VALUES,
	type SaveableOnboardingStep,
} from "@/lib/domains/library/accounts/onboarding-steps";
import {
	DEFAULT_MATCH_STRICTNESS,
	type MatchStrictness,
	STRICTNESS_MIN_SCORE,
} from "@/lib/domains/taste/song-matching/strictness";

/**
 * UI-layer orientation stored in the user's match-view preference (C10, B2).
 * Mirrored from features/matching/types without a cross-layer import so this
 * lib module stays within the lib dependency boundary.
 */
type MatchViewMode = "song" | "playlist";
const DEFAULT_MATCH_VIEW_MODE: MatchViewMode = "playlist";

import type { PhaseJobIds } from "@/lib/platform/jobs/progress/types";
import type { DbError } from "@/lib/shared/errors/database";
import {
	fromSupabaseMaybe,
	fromSupabaseSingle,
} from "@/lib/shared/utils/result-wrappers/supabase";

export type UserPreferences = Tables<"user_preferences">;

export const ONBOARDING_STEPS = z.enum(ONBOARDING_STEP_VALUES);
export const SAVEABLE_ONBOARDING_STEPS = z.enum(
	SAVEABLE_ONBOARDING_STEP_VALUES,
);
export type { OnboardingStep, SaveableOnboardingStep };

/**
 * Gets preferences for an account.
 * Returns null if no preferences record exists (use getOrCreatePreferences for auto-creation).
 */
function getPreferences(
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
				onboarding_step: DEFAULT_ONBOARDING_STEP,
			})
			.select()
			.single(),
	);
}

export async function isOnboardingComplete(
	accountId: string,
): Promise<Result<boolean, DbError>> {
	const result = await getPreferences(accountId);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	if (result.value === null) {
		return Result.ok(false);
	}

	return Result.ok(result.value.onboarding_completed_at !== null);
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

/**
 * Updates the match-strictness preference for an account.
 * Creates a preferences record if one doesn't exist. Mirrors updateTheme.
 *
 * Stores the preset *name* — the preset→score mapping lives in code
 * (strictness.ts) so thresholds can be retuned without a data migration.
 */
export function updateMatchStrictness(
	accountId: string,
	strictness: MatchStrictness,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.upsert(
				{
					account_id: accountId,
					match_strictness: strictness,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}

/**
 * Resolves the read-time minimum match score for an account from its
 * match-strictness preset. The single helper every read path calls.
 *
 * Falls back to the default preset's score on a missing row or any read error —
 * a strictness lookup must never block surfacing matches, and the column is
 * NOT NULL with a 'balanced' default so a present row is always a known preset.
 */
export async function resolveMinMatchScore(accountId: string): Promise<number> {
	const prefs = await getOrCreatePreferences(accountId);
	if (Result.isError(prefs)) {
		return STRICTNESS_MIN_SCORE[DEFAULT_MATCH_STRICTNESS];
	}

	const strictness = prefs.value.match_strictness as MatchStrictness;
	return (
		STRICTNESS_MIN_SCORE[strictness] ??
		STRICTNESS_MIN_SCORE[DEFAULT_MATCH_STRICTNESS]
	);
}

export function updateOnboardingStep(
	accountId: string,
	step: SaveableOnboardingStep,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.upsert(
				{
					account_id: accountId,
					onboarding_step: step,
					onboarding_completed_at: null,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}

/**
 * Compare-and-set completion write: only the call that flips a NULL
 * `onboarding_completed_at` to a timestamp "wins". `ok(null)` means zero rows
 * matched — onboarding was already complete — so concurrent completes can
 * never double-run downstream side effects (free allocation) or overwrite the
 * original completion timestamp.
 *
 * Update-only by design: the prefs row is guaranteed by getOrCreatePreferences
 * on every session load, so a missing row here is indistinguishable from
 * already-complete only in theory, never on a real call path.
 */
export function completeOnboarding(
	accountId: string,
): Promise<Result<UserPreferences | null, DbError>> {
	const supabase = createAdminSupabaseClient();
	const now = new Date().toISOString();

	return fromSupabaseMaybe(
		supabase
			.from("user_preferences")
			.update({ onboarding_completed_at: now })
			.eq("account_id", accountId)
			.is("onboarding_completed_at", null)
			.select()
			.maybeSingle(),
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

// Legacy orchestration pointer helpers removed — active job refs are now in
// library_processing_state, managed by src/lib/workflows/library-processing/

/**
 * Resolves an account's durable consent decision against the current policy.
 * A missing preferences row is "absent" (never decided), not an error.
 */
export async function resolveStoredConsent(
	accountId: string,
): Promise<Result<ResolvedConsent, DbError>> {
	const result = await getPreferences(accountId);

	if (Result.isError(result)) {
		return Result.err(result.error);
	}

	if (result.value === null) {
		return Result.ok({ state: "absent" });
	}

	return Result.ok(evaluateStoredConsent(result.value));
}

/**
 * Persists a consent decision as the durable source of truth for an account.
 * Stamps consent_updated_at so validity can be derived at read time, and
 * records the policy version the authenticated user decided under.
 */
export function saveConsentPreference(
	accountId: string,
	status: ConsentStatus,
	version: number,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.upsert(
				{
					account_id: accountId,
					consent_status: status,
					consent_updated_at: new Date().toISOString(),
					consent_version: version,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}

/**
 * Returns the stored match view mode for an account.
 * Falls back to the default ('playlist') when the row is missing or the read fails,
 * so the sidebar link and dashboard summaries are never blocked by a prefs read
 * error. Pattern mirrors resolveMinMatchScore.
 */
export async function getPreferredMatchViewMode(
	accountId: string,
): Promise<MatchViewMode> {
	const result = await getOrCreatePreferences(accountId);
	if (Result.isError(result)) {
		return DEFAULT_MATCH_VIEW_MODE;
	}

	const stored = result.value.match_view_mode;
	if (stored === "song" || stored === "playlist") {
		return stored;
	}
	return DEFAULT_MATCH_VIEW_MODE;
}

/**
 * Persists the user's preferred match view mode.
 * Upserts so a missing prefs row is created with the column set.
 * Mirrors updateMatchStrictness.
 */
export function setPreferredMatchViewMode(
	accountId: string,
	mode: MatchViewMode,
): Promise<Result<UserPreferences, DbError>> {
	const supabase = createAdminSupabaseClient();
	return fromSupabaseSingle(
		supabase
			.from("user_preferences")
			.upsert(
				{
					account_id: accountId,
					match_view_mode: mode,
				},
				{ onConflict: "account_id" },
			)
			.select()
			.single(),
	);
}
