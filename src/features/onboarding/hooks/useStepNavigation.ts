import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useRef } from "react";
import { toast } from "sonner";
import type { OnboardingStep } from "@/lib/domains/library/accounts/preferences-queries";
import type { OnboardingData } from "@/lib/server/onboarding.functions";
import { saveOnboardingStep } from "@/lib/server/onboarding.functions";
import { resolveStep } from "@/features/onboarding/step-resolver";

const ONBOARDING_QUERY_KEY = ["auth", "onboarding"] as const;

export function useStepNavigation() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const pendingRef = useRef(false);

	const navigateTo = useCallback(
		async (nextStep: OnboardingStep) => {
			if (pendingRef.current) return;
			pendingRef.current = true;

			try {
				await saveOnboardingStep({ data: { step: nextStep } });

				queryClient.setQueryData<OnboardingData>(
					ONBOARDING_QUERY_KEY,
					(prev) => (prev ? { ...prev, currentStep: nextStep } : prev),
				);

				queryClient.invalidateQueries({
					queryKey: ONBOARDING_QUERY_KEY,
				});

				const resolved = resolveStep(nextStep);

				if (resolved.allowedPath === "/onboarding") {
					await router.navigate({
						to: "/onboarding",
						search: { step: nextStep },
					});
				} else {
					await router.navigate({ to: resolved.allowedPath });
				}
			} catch (error) {
				console.error("Failed to navigate to step:", nextStep, error);
				toast.error("Something went wrong. Please try again.");
			} finally {
				pendingRef.current = false;
			}
		},
		[queryClient, router],
	);

	return { navigateTo, isPending: pendingRef };
}
