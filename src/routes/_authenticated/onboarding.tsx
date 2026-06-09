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
import { Onboarding } from "@/features/onboarding/Onboarding";
import {
	DEFAULT_ONBOARDING_STEP,
	isOnboardingStep,
	ONBOARDING_STEP_VALUES,
	type OnboardingStep,
} from "@/lib/domains/library/accounts/onboarding-steps";
import { getOnboardingData } from "@/lib/server/onboarding.functions";

/**
 * Search params parser - URL is the source of truth for navigation
 * Theme and jobId are loaded from DB, not URL.
 */
export interface OnboardingSearch {
	step: OnboardingStep;
}

function validateOnboardingSearch(
	search: Record<string, unknown>,
): OnboardingSearch {
	const step =
		typeof search.step === "string" && isOnboardingStep(search.step)
			? search.step
			: DEFAULT_ONBOARDING_STEP;

	return { step };
}

const ONBOARDING_DATA_QUERY_KEY = ["auth", "onboarding-data"] as const;

export const Route = createFileRoute("/_authenticated/onboarding")({
	validateSearch: validateOnboardingSearch,
	beforeLoad: async ({ search, context }) => {
		// Session is available from parent _authenticated layout
		const { session, queryClient } = context;
		const accountId = session.accountId;

		// Guard-critical data: force a fresh read on each navigation. `ensureQueryData`
		// can reuse cached data for this key, which makes step guards lag behind
		// recently-saved progress until a hard reload.
		const data = await queryClient.fetchQuery({
			queryKey: ONBOARDING_DATA_QUERY_KEY,
			queryFn: () => getOnboardingData(),
			staleTime: 0,
		});

		// Completed onboarding? Go to dashboard
		if (data.session.status === "complete") {
			throw redirect({ to: "/dashboard" });
		}

		// Step progression validation
		// Prevents users from manually navigating ahead of their saved progress
		const savedStep = data.session.status;
		const stepOrder = ONBOARDING_STEP_VALUES;
		const urlStepIndex = stepOrder.indexOf(search.step);
		const savedStepIndex = stepOrder.indexOf(savedStep);

		// Special case: auto-skip flag-playlists → pick-demo-song when user has no playlists
		// This is a valid forward jump that should bypass the guard
		const isAutoSkipFlagPlaylists =
			search.step === "pick-demo-song" &&
			savedStep === "flag-playlists" &&
			data.playlists.length === 0;

		const isAutoSkip = isAutoSkipFlagPlaylists;

		// Guard: If URL step is ahead of saved step, redirect back to saved step
		// (unless it's the valid auto-skip case)
		if (urlStepIndex > savedStepIndex && !isAutoSkip) {
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
				search: { step: "pick-demo-song" },
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
	// accountId is threaded explicitly so ClaimHandleStep can build its React
	// Query key without reading from the auth cache or guessing via route imports.
	const { accountId, onboardingData } = Route.useRouteContext();

	return <Onboarding step={step} data={onboardingData} accountId={accountId} />;
}
