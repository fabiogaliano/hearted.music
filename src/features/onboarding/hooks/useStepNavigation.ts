import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { resolveSession } from "@/features/onboarding/step-resolver";
import type { SaveableOnboardingStep } from "@/lib/domains/library/accounts/onboarding-steps";
import { ONBOARDING_SESSION_QUERY_KEY } from "@/lib/platform/auth/query-keys";
import {
	getOnboardingSession,
	saveOnboardingStep,
} from "@/lib/server/onboarding.functions";

export function useStepNavigation() {
	const queryClient = useQueryClient();
	const router = useRouter();
	// Ref guard is kept so the synchronous re-entry check inside `navigateTo`
	// is reliable even within a single render — `isPending` state lags by a
	// microtask. The public surface is the boolean; the ref stays private.
	const pendingRef = useRef(false);
	const [isPending, setIsPending] = useState(false);

	const navigateTo = useCallback(
		async (nextStep: SaveableOnboardingStep) => {
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
