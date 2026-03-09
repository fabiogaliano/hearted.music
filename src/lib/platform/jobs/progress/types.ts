/**
 * SSE Job Progress Types.
 *
 * Defines event types for real-time job progress updates.
 * Used by both server (emitter) and client (hook).
 */

import { z } from "zod";

// ============================================================================
// Job Status Types (shared with data/jobs.ts)
// ============================================================================

/**
 * Job status values (matches database enum job_status).
 * Terminal states: completed, failed
 */
export const JobStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

/** Terminal job statuses that signal completion */
export const TERMINAL_JOB_STATUSES = ["completed", "failed"] as const;
export type TerminalJobStatus = (typeof TERMINAL_JOB_STATUSES)[number];

// ============================================================================
// Job Progress Types (shared with data/jobs.ts)
// ============================================================================

/**
 * Job progress structure stored in JSONB.
 * Used for tracking sync progress and checkpoint data.
 */
export const JobProgressSchema = z.object({
	/** Total items to process */
	total: z.number().int().min(0),
	/** Items processed so far */
	done: z.number().int().min(0),
	/** Successfully processed items */
	succeeded: z.number().int().min(0),
	/** Failed items */
	failed: z.number().int().min(0),
	/** Cursor for pagination/resumption (e.g., timestamp, offset) */
	cursor: z.string().optional(),
});
export type JobProgress = z.infer<typeof JobProgressSchema>;

// ============================================================================
// Item Status Types
// ============================================================================

/** Status of an individual item being processed */
export const JobItemStatusSchema = z.enum([
	"queued",
	"in_progress",
	"succeeded",
	"failed",
]);
export type JobItemStatus = z.infer<typeof JobItemStatusSchema>;

/** Kind of item being processed */
export const JobItemKindSchema = z.enum(["song", "playlist", "match"]);
export type JobItemKind = z.infer<typeof JobItemKindSchema>;

// ============================================================================
// Event Types
// ============================================================================

/** Progress update with counts */
export const JobProgressEventSchema = z.object({
	type: z.literal("progress"),
	done: z.number(),
	total: z.number(),
	succeeded: z.number(),
	failed: z.number(),
});
export type JobProgressEvent = z.infer<typeof JobProgressEventSchema>;

/** Job status change (terminal states) */
export const JobStatusEventSchema = z.object({
	type: z.literal("status"),
	status: JobStatusSchema,
});
export type JobStatusEvent = z.infer<typeof JobStatusEventSchema>;

/** Individual item status update */
export const JobItemEventSchema = z.object({
	type: z.literal("item"),
	itemId: z.string(),
	itemKind: JobItemKindSchema,
	status: JobItemStatusSchema,
	/** Display label (e.g., "Artist – Title") */
	label: z.string().optional(),
	/** Position in batch */
	index: z.number().optional(),
	/** Current progress count (e.g., songs fetched so far) */
	count: z.number().optional(),
	/** Total items for this phase (set once during discovery) */
	total: z.number().optional(),
});
export type JobItemEvent = z.infer<typeof JobItemEventSchema>;

/** Error event */
export const JobErrorEventSchema = z.object({
	type: z.literal("error"),
	message: z.string(),
});
export type JobErrorEvent = z.infer<typeof JobErrorEventSchema>;

/** Union of all event types */
export const JobEventSchema = z.discriminatedUnion("type", [
	JobProgressEventSchema,
	JobStatusEventSchema,
	JobItemEventSchema,
	JobErrorEventSchema,
]);
export type JobEvent = z.infer<typeof JobEventSchema>;

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize an event to SSE format.
 * Format: `data: {...}\n\n`
 */
export function serializeSSEEvent(event: JobEvent): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Create SSE ping comment.
 * Comments are ignored by EventSource but keep connection alive.
 */
export function serializeSSEPing(): string {
	return ": ping\n\n";
}

/**
 * Parse SSE event from JSON string.
 * Returns null if parsing fails.
 */
export function parseSSEEvent(data: string): JobEvent | null {
	try {
		const parsed = JSON.parse(data);
		const result = JobEventSchema.safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

// ============================================================================
// Phase Job IDs
// ============================================================================

/**
 * Job IDs for each sync phase.
 * Used by onboarding flow to track 3 separate jobs.
 */
export const PhaseJobIdsSchema = z.object({
	liked_songs: z.uuid(),
	playlists: z.uuid(),
	playlist_tracks: z.uuid(),
});

export type PhaseJobIds = z.infer<typeof PhaseJobIdsSchema>;
