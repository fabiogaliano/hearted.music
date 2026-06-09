export const ONBOARDING_STEP_VALUES = [
	"welcome",
	"pick-color",
	"install-extension",
	"syncing",
	"claim-handle",
	"flag-playlists",
	"pick-demo-song",
	"song-walkthrough",
	"match-walkthrough",
	"plan-selection",
	"complete",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEP_VALUES)[number];

// Every step that can be written to user_preferences.onboarding_step.
// `complete` is excluded because completion is recorded via
// onboarding_completed_at, not the step column.
export const SAVEABLE_ONBOARDING_STEP_VALUES = [
	"welcome",
	"pick-color",
	"install-extension",
	"syncing",
	"claim-handle",
	"flag-playlists",
	"pick-demo-song",
	"song-walkthrough",
	"match-walkthrough",
	"plan-selection",
] as const satisfies ReadonlyArray<OnboardingStep>;

export type SaveableOnboardingStep =
	(typeof SAVEABLE_ONBOARDING_STEP_VALUES)[number];

export const DEFAULT_ONBOARDING_STEP = ONBOARDING_STEP_VALUES[0];

const onboardingStepSet = new Set<string>(ONBOARDING_STEP_VALUES);

export function isOnboardingStep(value: string): value is OnboardingStep {
	return onboardingStepSet.has(value);
}

/** Negative = a before b, 0 = equal, positive = a after b. */
export function compareOnboardingSteps(
	a: OnboardingStep,
	b: OnboardingStep,
): number {
	return ONBOARDING_STEP_VALUES.indexOf(a) - ONBOARDING_STEP_VALUES.indexOf(b);
}

/** True when `step` comes strictly before `boundary` in the ordered tuple. */
export function isOnboardingStepBefore(
	step: OnboardingStep,
	boundary: OnboardingStep,
): boolean {
	return compareOnboardingSteps(step, boundary) < 0;
}

/** The step immediately before `step`, or null if `step` is the first. */
export function getPreviousOnboardingStep(
	step: OnboardingStep,
): OnboardingStep | null {
	const idx = ONBOARDING_STEP_VALUES.indexOf(step);
	if (idx <= 0) return null;
	return ONBOARDING_STEP_VALUES[idx - 1] ?? null;
}

/** The step immediately after `step`, or null if `step` is the last. */
export function getNextOnboardingStep(
	step: OnboardingStep,
): OnboardingStep | null {
	const idx = ONBOARDING_STEP_VALUES.indexOf(step);
	if (idx < 0 || idx >= ONBOARDING_STEP_VALUES.length - 1) return null;
	return ONBOARDING_STEP_VALUES[idx + 1] ?? null;
}

/**
 * True when saving `step` should also clear phase_job_ids.
 *
 * The sync-phase jobs are only relevant while the user is at or before the
 * `syncing` step. `claim-handle` is the first post-sync step, so it and every
 * step after it clears the job reference.
 */
export function clearsSyncPhaseJobIds(step: OnboardingStep): boolean {
	return !isOnboardingStepBefore(step, "claim-handle");
}
