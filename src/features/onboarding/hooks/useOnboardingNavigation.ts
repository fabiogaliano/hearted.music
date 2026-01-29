/**
 * Navigation hook for onboarding flow.
 * Handles step transitions and saves progress to DB for resumability.
 *
 * ## State Management Pattern: Navigation State + DB Fallback
 *
 * We pass ephemeral data (phaseJobIds, syncStats) through TanStack Router's
 * navigation state for instant UX, with DB fallback for page refresh.
 *
 * ### Why This Pattern?
 * - **0 API calls** during normal flow (maximum speed)
 * - **DB fallback** handles page refresh (phaseJobIds persisted to DB)
 * - **Optimistic UX** - navigation feels instant
 *
 * ### Data Flow
 * ```
 * Happy Path (client-side state):
 * welcome → createSyncJob() → phaseJobIds (also saved to DB)
 *    ↓
 * navigate({ state: { phaseJobIds } })
 *    ↓
 * next step reads: location.state.phaseJobIds ✅
 *
 * Refresh Path (DB fallback):
 * User refreshes → location.state = undefined
 *    ↓
 * beforeLoad fetches from DB → data.phaseJobIds ✅
 *    ↓
 * Component uses: location.state.phaseJobIds ?? data.phaseJobIds
 * ```
 *
 * @see Onboarding.tsx for the fallback pattern implementation
 */

import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { saveOnboardingStep, type LibrarySummary } from "@/lib/server/onboarding.server";
import { type OnboardingStep } from "@/lib/data/preferences";
import type { PhaseJobIds } from "@/lib/jobs/progress/types";
import "../types"; // Import to ensure HistoryState augmentation is loaded

export function useOnboardingNavigation() {
	const navigate = useNavigate({ from: "/onboarding" });

	const goToStep = useCallback(
		async (
			step: OnboardingStep,
			options?: {
				phaseJobIds?: PhaseJobIds;
				syncStats?: { songs: number; playlists: number };
				librarySummary?: LibrarySummary;
			},
		) => {
			try {
				// Save step to DB for resumability
				await saveOnboardingStep({ data: { step } });

				// Update URL and pass state (merge current state with new options)
				navigate({
					search: (prev) => ({
						...prev,
						step,
					}),
					state: (prev) => ({
						...prev,
						...(options?.phaseJobIds !== undefined && {
							phaseJobIds: options.phaseJobIds,
						}),
						...(options?.syncStats !== undefined && {
							syncStats: options.syncStats,
						}),
						...(options?.librarySummary !== undefined && {
							librarySummary: options.librarySummary,
						}),
					}),
				});
			} catch (error) {
				console.error("Failed to save onboarding step:", error);
				toast.error("Something went wrong. Please try again.");
				// Don't navigate if save fails - prevents state mismatch
			}
		},
		[navigate],
	);

	return { goToStep };
}
