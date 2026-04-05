import type { LibraryProcessingChange } from "../types";

export const BillingChanges = {
	songsUnlocked(
		accountId: string,
		songIds: string[],
	): LibraryProcessingChange & { kind: "songs_unlocked" } {
		return { kind: "songs_unlocked", accountId, songIds };
	},

	unlimitedActivated(
		accountId: string,
	): LibraryProcessingChange & { kind: "unlimited_activated" } {
		return { kind: "unlimited_activated", accountId };
	},

	candidateAccessRevoked(
		accountId: string,
	): LibraryProcessingChange & { kind: "candidate_access_revoked" } {
		return { kind: "candidate_access_revoked", accountId };
	},
};
