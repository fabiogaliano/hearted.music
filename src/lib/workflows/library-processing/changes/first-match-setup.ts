import type { LibraryProcessingChange } from "../types";

export const FirstMatchSetupChanges = {
	setupCompleted(
		accountId: string,
	): Extract<LibraryProcessingChange, { kind: "first_match_setup_completed" }> {
		return { kind: "first_match_setup_completed", accountId };
	},
};
