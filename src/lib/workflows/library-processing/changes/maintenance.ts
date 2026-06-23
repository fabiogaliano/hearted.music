import type { LibraryProcessingChange } from "../types";

export const MaintenanceChanges = {
	enrichmentWorkAvailable(
		accountId: string,
	): Extract<LibraryProcessingChange, { kind: "enrichment_work_available" }> {
		return { kind: "enrichment_work_available", accountId };
	},
};
