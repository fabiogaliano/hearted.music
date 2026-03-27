import type { LibraryProcessingChange } from "../types";

export const SyncChanges = {
	librarySynced(
		accountId: string,
		changes: {
			likedSongs: { added: boolean; removed: boolean };
			targetPlaylists: {
				trackMembershipChanged: boolean;
				profileTextChanged: boolean;
				removed: boolean;
			};
		},
	): LibraryProcessingChange & { kind: "library_synced" } {
		return { kind: "library_synced", accountId, changes };
	},
};
