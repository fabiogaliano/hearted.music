/**
 * /onboarding - Onboarding flow route
 *
 * Uses URL search params as state machine for wizard steps.
 * Supports resumability - user can refresh and continue from saved step.
 *
 * URL format: /onboarding?step=syncing
 * Theme and jobId are loaded from DB, not URL.
 *
 * Auth is handled by parent _authenticated layout - this route only
 * handles onboarding-specific business logic.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { ONBOARDING_STEPS } from "@/lib/data/preferences";
import { getOnboardingData } from "@/lib/server/onboarding.server";

/**
 * Search params schema - URL is the source of truth for navigation
 * Theme and jobId are loaded from DB, not URL.
 */
const onboardingSearchSchema = z.object({
	step: fallback(ONBOARDING_STEPS, "welcome").default("welcome"),
});
export type OnboardingSearch = z.infer<typeof onboardingSearchSchema>;

export const Route = createFileRoute("/_authenticated/onboarding")({
	validateSearch: zodValidator(onboardingSearchSchema),
	beforeLoad: async ({ search, context }) => {
		// Session is available from parent _authenticated layout
		const { session } = context;
		const accountId = session.accountId;

		// Load onboarding data (auth errors throw via requireSession internally)
		const data = await getOnboardingData();

		// Completed onboarding? Go to dashboard
		if (data.isComplete) {
			throw redirect({ to: "/dashboard" });
		}

		// Step progression validation
		// Prevents users from manually navigating ahead of their saved progress
		const savedStep = data.currentStep;
		const stepOrder = ONBOARDING_STEPS.options;
		const urlStepIndex = stepOrder.indexOf(search.step);
		const savedStepIndex = stepOrder.indexOf(savedStep);

		// Special case: auto-skip flag-playlists → ready when user has no playlists
		// This is a valid forward jump that should bypass the guard
		const isAutoSkipToReady =
			search.step === "ready" &&
			savedStep === "flag-playlists" &&
			data.playlists.length === 0;

		// Guard: If URL step is ahead of saved step, redirect back to saved step
		// (unless it's the valid auto-skip case)
		if (urlStepIndex > savedStepIndex && !isAutoSkipToReady) {
			throw redirect({
				to: "/onboarding",
				search: { step: savedStep },
			});
		}

		// Resume: If URL is at "welcome" but user has progressed further, resume from saved step
		if (search.step === "welcome" && savedStep !== "welcome") {
			throw redirect({
				to: "/onboarding",
				search: { step: savedStep },
			});
		}

		// Skip flag-playlists step if user has no playlists
		if (search.step === "flag-playlists" && data.playlists.length === 0) {
			throw redirect({
				to: "/onboarding",
				search: { step: "ready" },
			});
		}

		// Provide data in route context
		return {
			accountId,
			onboardingData: data,
		};
	},
	component: OnboardingPage,
});

function OnboardingPage() {
	const { step } = Route.useSearch();
	const { onboardingData } = Route.useRouteContext();

	return <Onboarding step={step} data={onboardingData} />;
}
