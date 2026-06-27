import type { LibraryProcessingChange } from "../types";

export const PlaylistManagementChanges = {
	sessionFlushed(opts: {
		accountId: string;
		targetMembershipChanged: boolean;
		scoringConfigChanged: boolean;
		readTimeFilterChanged: boolean;
	}): Extract<
		LibraryProcessingChange,
		{ kind: "playlist_management_session_flushed" }
	> {
		return { kind: "playlist_management_session_flushed", ...opts };
	},
};
