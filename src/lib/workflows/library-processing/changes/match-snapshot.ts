import type { LibraryProcessingChange } from "../types";

export const MatchSnapshotChanges = {
	published(opts: {
		accountId: string;
		jobId: string;
	}): LibraryProcessingChange & { kind: "match_snapshot_published" } {
		return { kind: "match_snapshot_published", ...opts };
	},

	failed(opts: {
		accountId: string;
		jobId: string;
	}): LibraryProcessingChange & { kind: "match_snapshot_failed" } {
		return { kind: "match_snapshot_failed", ...opts };
	},
};
