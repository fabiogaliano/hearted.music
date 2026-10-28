import { z } from "zod";

// A blank snapshotId names no snapshot.
const snapshotId = z.string().min(1);

/**
 * What a deck job is asked to do: its kind plus the payload that kind needs.
 * Enqueue writes it and the worker decodes `{ kind, payload }` from the row
 * with it, so both sides agree on one shape. Lives apart from deck-jobs.ts
 * (the DB layer) because the worker's tests mock that module wholesale.
 */
export const DeckJobSpec = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("build_proposals"),
		payload: z.object({ snapshotId }),
	}),
	z.object({
		kind: z.literal("append_sessions"),
		payload: z.object({ snapshotId }),
	}),
	z.object({
		kind: z.literal("repair"),
		// A repair that names no usable snapshot rebuilds against the latest one,
		// so an unusable payload means "latest" rather than a failed job.
		payload: z.object({ snapshotId: snapshotId.optional() }).catch({}),
	}),
	// Session-scoped via the session_id column; the payload is unused.
	z.object({ kind: z.literal("capture_ahead") }),
]);

export type DeckJobSpec = z.infer<typeof DeckJobSpec>;
