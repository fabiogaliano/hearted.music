export const ONBOARDING_STEP_VALUES = [
	"welcome",
	"pick-color",
	"install-extension",
	"syncing",
	"flag-playlists",
	"pick-demo-song",
	"song-walkthrough",
	"match-walkthrough",
	"plan-selection",
	"complete",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEP_VALUES)[number];

export const DEFAULT_ONBOARDING_STEP = ONBOARDING_STEP_VALUES[0];

const onboardingStepSet = new Set<string>(ONBOARDING_STEP_VALUES);

export function isOnboardingStep(value: string): value is OnboardingStep {
	return onboardingStepSet.has(value);
}
