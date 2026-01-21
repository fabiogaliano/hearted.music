/**
 * Job Progress Helpers.
 *
 * Convenience functions for emitting SSE events from services.
 * Wraps the emitter with typed helper functions.
 */

import type { JobProgress, JobStatus } from "@/lib/data/jobs";
import { emit } from "./emitter";
import type {
	JobErrorEvent,
	JobItemEvent,
	JobItemKind,
	JobItemStatus,
	JobProgressEvent,
	JobStatusEvent,
} from "./types";

// ============================================================================
// Progress Helpers
// ============================================================================

/**
 * Emit a progress update event.
 */
export function emitProgress(jobId: string, progress: JobProgress): void {
	const event: JobProgressEvent = {
		type: "progress",
		done: progress.done,
		total: progress.total,
		succeeded: progress.succeeded,
		failed: progress.failed,
	};
	emit(jobId, event);
}

/**
 * Emit a status change event.
 */
export function emitStatus(jobId: string, status: JobStatus): void {
	const event: JobStatusEvent = {
		type: "status",
		status,
	};
	emit(jobId, event);
}

/**
 * Emit an item status update event.
 */
export function emitItem(
	jobId: string,
	item: {
		itemId: string;
		itemKind: JobItemKind;
		status: JobItemStatus;
		label?: string;
		index?: number;
	},
): void {
	const event: JobItemEvent = {
		type: "item",
		itemId: item.itemId,
		itemKind: item.itemKind,
		status: item.status,
		...(item.label && { label: item.label }),
		...(item.index !== undefined && { index: item.index }),
	};
	emit(jobId, event);
}

/**
 * Emit an error event.
 */
export function emitError(jobId: string, message: string): void {
	const event: JobErrorEvent = {
		type: "error",
		message,
	};
	emit(jobId, event);
}

// ============================================================================
// Batch Helpers
// ============================================================================

/**
 * Emit progress for a batch operation.
 * Calculates counts from current progress and batch result.
 */
export function emitBatchProgress(
	jobId: string,
	current: { done: number; succeeded: number; failed: number },
	batchResult: { succeeded: number; failed: number },
	total: number,
): void {
	emitProgress(jobId, {
		total,
		done: current.done + batchResult.succeeded + batchResult.failed,
		succeeded: current.succeeded + batchResult.succeeded,
		failed: current.failed + batchResult.failed,
	});
}

/**
 * Emit item events for a batch of items.
 * Useful for marking multiple items as queued/succeeded/failed at once.
 */
export function emitItemBatch(
	jobId: string,
	items: Array<{
		itemId: string;
		itemKind: JobItemKind;
		status: JobItemStatus;
		label?: string;
	}>,
	startIndex = 0,
): void {
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		emitItem(jobId, {
			...item,
			index: startIndex + i,
		});
	}
}
