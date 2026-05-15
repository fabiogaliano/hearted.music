import type { LibraryProcessingChange } from "../types";

export const EnrichmentChanges = {
	completed(opts: {
		accountId: string;
		jobId: string;
		requestSatisfied: boolean;
		newCandidatesAvailable: boolean;
	}): Extract<LibraryProcessingChange, { kind: "enrichment_completed" }> {
		return { kind: "enrichment_completed", ...opts };
	},

	stopped(opts: {
		accountId: string;
		jobId: string;
		reason: "local_limit" | "error";
	}): Extract<LibraryProcessingChange, { kind: "enrichment_stopped" }> {
		return { kind: "enrichment_stopped", ...opts };
	},
};
