import { z } from "zod";

export const MatchSnapshotRefreshPlanSchema = z.object({
	needsTargetSongEnrichment: z.boolean(),
});

export type MatchSnapshotRefreshPlan = z.infer<
	typeof MatchSnapshotRefreshPlanSchema
>;

export interface MatchSnapshotRefreshResult {
	readonly published: boolean;
	readonly snapshotId: string | null;
	readonly matchedSongCount: number;
	readonly candidateCount: number;
	readonly playlistCount: number;
	readonly isEmpty: boolean;
	readonly noOp: boolean;
}

export type MatchSnapshotRefreshOutcome =
	| { status: "published"; result: MatchSnapshotRefreshResult }
	| { status: "superseded" }
	// The heartbeat saw this claim taken over; the snapshot was not published.
	| { status: "lease_lost" };

/** What one worker-run match snapshot refresh reports back to the runner. */
export type MatchSnapshotRefreshExecuteResult =
	| {
			status: "published";
			accountId: string;
			jobId: string;
			published: boolean;
			isEmpty: boolean;
			snapshotId: string | null;
	  }
	| { status: "superseded"; accountId: string; jobId: string }
	// This worker's claim was taken over mid-run; nothing after the refresh
	// itself was emitted or enqueued.
	| { status: "lease_lost"; accountId: string; jobId: string };
