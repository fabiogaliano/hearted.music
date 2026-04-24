import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { OnboardingStep } from "@/lib/domains/library/accounts/preferences-queries";
import {
	getOnboardingSession,
	saveOnboardingStep,
} from "@/lib/server/onboarding.functions";
import { resolveSession } from "@/features/onboarding/step-resolver";

const ONBOARDING_SESSION_QUERY_KEY = ["auth", "onboarding-session"] as const;

export function useStepNavigation() {
	const queryClient = useQueryClient();
	const router = useRouter();
	// Ref guard is kept so the synchronous re-entry check inside `navigateTo`
	// is reliable even within a single render — `isPending` state lags by a
	// microtask. The public surface is the boolean; the ref stays private.
	const pendingRef = useRef(false);
	const [isPending, setIsPending] = useState(false);

	const navigateTo = useCallback(
		async (nextStep: OnboardingStep) => {
			if (pendingRef.current) return;
			pendingRef.current = true;
			setIsPending(true);

			try {
				await saveOnboardingStep({ data: { step: nextStep } });

				// Fetch the authoritative session before navigating so route
				// guards never read a partially-patched cache. `fetchQuery` is
				// imperative and doesn't require an active observer (which
				// `refetchQueries` would, default type: 'active').
				const payload = await queryClient.fetchQuery({
					queryKey: ONBOARDING_SESSION_QUERY_KEY,
					queryFn: () => getOnboardingSession(),
				});

				const { allowedPath } = resolveSession(payload.session);

				if (allowedPath === "/onboarding") {
					await router.navigate({
						to: "/onboarding",
						search: { step: nextStep },
					});
				} else {
					await router.navigate({ to: allowedPath });
				}
			} catch (error) {
				console.error("Failed to navigate to step:", nextStep, error);
				toast.error("Something went wrong. Please try again.");
			} finally {
				pendingRef.current = false;
				setIsPending(false);
			}
		},
		[queryClient, router],
	);

	return { navigateTo, isPending };
}
