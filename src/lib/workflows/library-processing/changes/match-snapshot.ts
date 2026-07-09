import type { LibraryProcessingChange } from "../types";

export const MatchSnapshotChanges = {
	published(opts: {
		accountId: string;
		jobId: string;
		snapshotId?: string;
	}): Extract<LibraryProcessingChange, { kind: "match_snapshot_published" }> {
		return { kind: "match_snapshot_published", ...opts };
	},

	failed(opts: {
		accountId: string;
		jobId: string;
		snapshotId?: string | null;
	}): Extract<LibraryProcessingChange, { kind: "match_snapshot_failed" }> {
		return { kind: "match_snapshot_failed", ...opts };
	},

	superseded(opts: {
		accountId: string;
		jobId: string;
	}): Extract<LibraryProcessingChange, { kind: "match_snapshot_superseded" }> {
		return { kind: "match_snapshot_superseded", ...opts };
	},
};
