/**
 * /onboarding - Onboarding flow route
 *
 * Uses URL search params as state machine for wizard steps.
 * Supports resumability - user can refresh and continue from saved step.
 *
 * URL format: /onboarding?step=syncing
 * Theme and jobId are loaded from DB, not URL.
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import {
	getOnboardingData,
	type OnboardingData,
} from "@/lib/server/onboarding.server";
import { ONBOARDING_STEPS } from "@/lib/data/preferences";
import { Onboarding } from "@/features/onboarding/Onboarding";


/**
 * Search params schema - URL is the source of truth for navigation
 * Theme and jobId are loaded from DB, not URL.
 */
const onboardingSearchSchema = z.object({
	step: fallback(ONBOARDING_STEPS, "welcome").default("welcome"),
});
export type OnboardingSearch = z.infer<typeof onboardingSearchSchema>;


/**
 * Server function to check auth and load onboarding data.
 * Must be a server function because getRequest() is server-only.
 */
const getOnboardingPageData = createServerFn({ method: "GET" }).handler(
	async (): Promise<
		| { authenticated: false }
		| { authenticated: true; isComplete: true }
		| {
				authenticated: true;
				isComplete: false;
				accountId: string;
				data: OnboardingData;
		  }
	> => {
		const request = getRequest();
		const session = getSession(request);

		if (!session) {
			return { authenticated: false };
		}

		const data = await getOnboardingData();

		if (data.isComplete) {
			return { authenticated: true, isComplete: true };
		}

		return {
			authenticated: true,
			isComplete: false,
			accountId: session.accountId,
			data,
		};
	},
);

export const Route = createFileRoute("/onboarding")({
	validateSearch: zodValidator(onboardingSearchSchema),
	beforeLoad: async ({ search }) => {
		const result = await getOnboardingPageData();

		// Not authenticated - redirect to home
		if (!result.authenticated) {
			throw redirect({ to: "/" });
		}

		// Onboarding complete - redirect to app
		if (result.isComplete) {
			throw redirect({ to: "/" });
		}

		// Resume from saved step if URL doesn't specify one (or is at default "welcome")
		// This handles direct navigation to /onboarding without ?step= param
		const savedStep = result.data.currentStep;
		if (search.step === "welcome" && savedStep !== "welcome") {
			throw redirect({
				to: "/onboarding",
				search: { step: savedStep },
			});
		}

		// Skip flag-playlists step if user has no playlists
		if (search.step === "flag-playlists" && result.data.playlists.length === 0) {
			throw redirect({
				to: "/onboarding",
				search: { step: "ready" },
			});
		}

		// Provide data in route context
		return {
			accountId: result.accountId,
			onboardingData: result.data,
		};
	},
	component: OnboardingPage,
});

function OnboardingPage() {
	const { step } = Route.useSearch();
	const { onboardingData } = Route.useRouteContext();

	return <Onboarding step={step} data={onboardingData} />;
}
