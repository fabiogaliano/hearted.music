import type { LibraryProcessingChange } from "../types";

export const BillingChanges = {
	songsUnlocked(
		accountId: string,
		songIds: string[],
	): Extract<LibraryProcessingChange, { kind: "songs_unlocked" }> {
		return { kind: "songs_unlocked", accountId, songIds };
	},

	unlimitedActivated(
		accountId: string,
	): Extract<LibraryProcessingChange, { kind: "unlimited_activated" }> {
		return { kind: "unlimited_activated", accountId };
	},

	candidateAccessRevoked(
		accountId: string,
	): Extract<LibraryProcessingChange, { kind: "candidate_access_revoked" }> {
		return { kind: "candidate_access_revoked", accountId };
	},
};
