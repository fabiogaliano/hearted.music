/**
 * Job Event Emitter.
 *
 * In-memory pub/sub for SSE job progress events.
 * Edge-compatible: no Node.js EventEmitter dependency.
 *
 * Usage:
 *   // Subscribe (in SSE endpoint)
 *   const unsubscribe = subscribe(jobId, (event) => {
 *     controller.enqueue(encoder.encode(serializeSSEEvent(event)))
 *   })
 *
 *   // Emit (in services)
 *   emit(jobId, { type: 'progress', done: 5, total: 10, succeeded: 5, failed: 0 })
 *
 *   // Cleanup (on job completion)
 *   unsubscribeAll(jobId)
 */

import type { JobEvent } from "./types";

// ============================================================================
// Types
// ============================================================================

/** Callback function for job events */
type JobEventCallback = (event: JobEvent) => void;

/** Subscriber store: jobId → Set of callbacks */
const subscribers = new Map<string, Set<JobEventCallback>>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Subscribe to events for a job.
 * Returns an unsubscribe function.
 */
export function subscribe(
	jobId: string,
	callback: JobEventCallback,
): () => void {
	if (!subscribers.has(jobId)) {
		subscribers.set(jobId, new Set());
	}
	subscribers.get(jobId)!.add(callback);

	// Return unsubscribe function
	return () => {
		const callbacks = subscribers.get(jobId);
		if (callbacks) {
			callbacks.delete(callback);
			// Clean up empty sets
			if (callbacks.size === 0) {
				subscribers.delete(jobId);
			}
		}
	};
}

/**
 * Emit an event to all subscribers of a job.
 */
export function emit(jobId: string, event: JobEvent): void {
	const callbacks = subscribers.get(jobId);
	if (callbacks) {
		for (const callback of callbacks) {
			try {
				callback(event);
			} catch (error) {
				// Log but don't throw - one subscriber error shouldn't affect others
				console.error(`[SSE] Error in subscriber for job ${jobId}:`, error);
			}
		}
	}
}

/**
 * Remove all subscribers for a job.
 * Call this when job reaches terminal state to prevent memory leaks.
 */
export function unsubscribeAll(jobId: string): void {
	subscribers.delete(jobId);
}

/**
 * Get the number of subscribers for a job.
 * Useful for debugging/monitoring.
 */
export function getSubscriberCount(jobId: string): number {
	return subscribers.get(jobId)?.size ?? 0;
}

/**
 * Check if a job has any subscribers.
 */
export function hasSubscribers(jobId: string): boolean {
	return (subscribers.get(jobId)?.size ?? 0) > 0;
}
