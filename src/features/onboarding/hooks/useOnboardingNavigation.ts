/**
 * Navigation hook for onboarding flow.
 * Handles step transitions and saves progress to DB for resumability.
 *
 * ## State Management Pattern: Navigation State + DB Fallback
 *
 * We pass ephemeral data (phaseJobIds) through TanStack Router's navigation
 * state for instant UX, with DB fallback for page refresh.
 *
 * ### Why This Pattern?
 * - **0 API calls** during normal flow (maximum speed)
 * - **DB fallback** handles page refresh (phaseJobIds persisted to DB)
 * - **Optimistic UX** - navigation feels instant
 *
 * ### Data Flow
 * ```
 * Happy Path (extension-driven):
 * welcome → pick-color → install-extension → syncing
 *    ↓
 * Extension POSTs to /api/extension/sync → creates phaseJobIds (saved to DB)
 *    ↓
 * SyncingStep polls DB via usePolledPhaseJobIds() → discovers phaseJobIds ✅
 *
 * Refresh Path (DB fallback):
 * User refreshes → location.state = undefined
 *    ↓
 * beforeLoad fetches from DB → data.phaseJobIds ✅
 *    ↓
 * Component uses:
 *   location.state.phaseJobIds !== undefined
 *     ? location.state.phaseJobIds
 *     : data.phaseJobIds
 * ```
 *
 * @see Onboarding.tsx for the fallback pattern implementation
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { SaveableOnboardingStep } from "@/lib/domains/library/accounts/onboarding-steps";
import { ONBOARDING_SESSION_QUERY_KEY } from "@/lib/platform/auth/query-keys";
import type { PhaseJobIds } from "@/lib/platform/jobs/progress/types";
import {
	getOnboardingSession,
	saveOnboardingStep,
} from "@/lib/server/onboarding.functions";
import "../types"; // Import to ensure HistoryState augmentation is loaded

export type OnboardingStepTransitionResult =
	| { status: "transitioned" }
	| { status: "transition_failed" };

export function useOnboardingNavigation() {
	const queryClient = useQueryClient();
	const navigate = useNavigate({ from: "/onboarding" });

	const goToStep = useCallback(
		async (
			step: SaveableOnboardingStep,
			options?: {
				phaseJobIds?: PhaseJobIds | null;
			},
		): Promise<OnboardingStepTransitionResult> => {
			try {
				// Save step to DB for resumability
				await saveOnboardingStep({ data: { step } });

				// Authoritative refetch of the session before the next render.
				// Prevents guards in `/_authenticated` from reading a stale
				// session during the transition. Same pattern as useStepNavigation.
				await queryClient.fetchQuery({
					queryKey: ONBOARDING_SESSION_QUERY_KEY,
					queryFn: () => getOnboardingSession(),
				});

				// Update URL and pass state (merge current state with new options).
				// Awaiting matches `useStepNavigation` so `goToStep` resolves only
				// after navigation settles — callers can rely on ordering.
				await navigate({
					search: (prev) => ({
						...prev,
						step,
					}),
					state: (prev) => ({
						...prev,
						...(options?.phaseJobIds !== undefined && {
							phaseJobIds: options.phaseJobIds,
						}),
					}),
				});

				return { status: "transitioned" };
			} catch (error) {
				console.error("Failed to save onboarding step:", error);
				// Return failure rather than throw — callers branch on status,
				// show their own context-appropriate toast, and reset their own state.
				return { status: "transition_failed" };
			}
		},
		[navigate, queryClient],
	);

	return { goToStep };
}
