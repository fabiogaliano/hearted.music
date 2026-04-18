import type { OnboardingStep } from "@/lib/domains/library/accounts/preferences-queries";

export type OnboardingMode = "complete" | "steps" | "walkthrough";

export type WalkthroughSong = {
	id: string;
	spotifyTrackId: string;
	slug: string;
	name: string;
	artist: string;
	album: string | null;
	albumArtUrl: string | null;
};

export type AllowedPath = "/onboarding" | "/liked-songs" | "/match";

export type ResolvedStep = {
	allowedPath: AllowedPath;
	onboardingMode: "steps" | "walkthrough";
};

const STEP_MAP: Partial<Record<OnboardingStep, ResolvedStep>> = {
	"song-walkthrough": {
		allowedPath: "/liked-songs",
		onboardingMode: "walkthrough",
	},
	"match-walkthrough": {
		allowedPath: "/match",
		onboardingMode: "walkthrough",
	},
};

const DEFAULT_RESOLVED: ResolvedStep = {
	allowedPath: "/onboarding",
	onboardingMode: "steps",
};

export function resolveStep(step: OnboardingStep): ResolvedStep {
	return STEP_MAP[step] ?? DEFAULT_RESOLVED;
}

export function isPathAllowed(
	pathname: string,
	resolved: ResolvedStep,
): boolean {
	return pathname === resolved.allowedPath;
}
