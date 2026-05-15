import type { LibraryProcessingChange } from "../types";

export const OnboardingChanges = {
	targetSelectionConfirmed(
		accountId: string,
	): Extract<
		LibraryProcessingChange,
		{ kind: "onboarding_target_selection_confirmed" }
	> {
		return { kind: "onboarding_target_selection_confirmed", accountId };
	},
};
