/**
 * useJobProgress - React hook for consuming SSE job progress events.
 *
 * Connects to the SSE endpoint and provides real-time job progress updates.
 * Integrates with TanStack Query for cache updates.
 *
 * Usage:
 *   const { progress, status, items, currentItem, error, isConnected } = useJobProgress(jobId)
 */

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	JobEvent,
	JobItemEvent,
	JobItemStatus,
	JobProgressEvent,
	JobStatusEvent,
} from "@/lib/jobs/progress/types";
import { parseSSEEvent } from "@/lib/jobs/progress/types";

// ============================================================================
// Types
// ============================================================================

export interface JobProgressState {
	/** Current progress counts */
	progress: JobProgressEvent | null;
	/** Current job status */
	status: JobStatusEvent["status"] | null;
	/** Map of item ID to status */
	items: Map<string, JobItemEvent>;
	/** Map of item ID to discovered total (max count seen) */
	itemTotals: Map<string, number>;
	/** Currently processing item (status = "in_progress") */
	currentItem: JobItemEvent | null;
	/** Connection error message */
	error: string | null;
	/** Whether EventSource is connected */
	isConnected: boolean;
}

// Create fresh initial state for each component instance
const createInitialState = (): JobProgressState => ({
	progress: null,
	status: null,
	items: new Map(),
	itemTotals: new Map(),
	currentItem: null,
	error: null,
	isConnected: false,
});

// ============================================================================
// Hook
// ============================================================================

/**
 * Subscribe to real-time job progress updates via SSE.
 *
 * @param jobId - Job UUID to subscribe to, or null to skip
 * @returns Job progress state with progress, status, items, and connection info
 */
export function useJobProgress(jobId: string | null): JobProgressState {
	const [state, setState] = useState<JobProgressState>(createInitialState);
	const queryClient = useQueryClient();
	const eventSourceRef = useRef<EventSource | null>(null);
	const queryClientRef = useRef(queryClient);

	// Keep queryClient ref updated (avoids stale closure without causing effect re-runs)
	useEffect(() => {
		queryClientRef.current = queryClient;
	}, [queryClient]);

	// Handle incoming SSE event (stable reference - uses refs to avoid dependency changes)
	const handleEvent = useCallback(
		(event: JobEvent, currentJobId: string) => {
			const qc = queryClientRef.current;

			switch (event.type) {
				case "progress":
					setState((prev) => ({ ...prev, progress: event }));
					// Update TanStack Query cache
					qc.setQueryData(["job", currentJobId], (old: unknown) => ({
						...(typeof old === "object" && old !== null ? old : {}),
						progress: {
							done: event.done,
							total: event.total,
							succeeded: event.succeeded,
							failed: event.failed,
						},
					}));
					break;

				case "status":
					setState((prev) => ({ ...prev, status: event.status }));
					// Update TanStack Query cache
					qc.setQueryData(["job", currentJobId], (old: unknown) => ({
						...(typeof old === "object" && old !== null ? old : {}),
						status: event.status,
					}));
					// On terminal status: invalidate queries and close EventSource
					if (event.status === "completed" || event.status === "failed") {
						qc.invalidateQueries({ queryKey: ["songs"] });
						qc.invalidateQueries({ queryKey: ["playlists"] });
						// Close to prevent auto-reconnect loop
						eventSourceRef.current?.close();
						eventSourceRef.current = null;
					}
					break;

				case "item":
					setState((prev) => {
						const newItems = new Map(prev.items);
						newItems.set(event.itemId, event);

						// Update item totals - prefer explicit total field over max(count)
						const newItemTotals = new Map(prev.itemTotals);
						if (event.total != null) {
							// Explicit total from discovery phase - use directly
							newItemTotals.set(event.itemId, event.total);
						} else if (event.count != null) {
							// Fallback: track max count as "discovered total" for smooth progress
							const currentMax = newItemTotals.get(event.itemId) ?? 0;
							newItemTotals.set(event.itemId, Math.max(currentMax, event.count));
						}

						const newCurrentItem =
							event.status === "in_progress"
								? event
								: event.itemId === prev.currentItem?.itemId
									? null
									: prev.currentItem;
						return { ...prev, items: newItems, itemTotals: newItemTotals, currentItem: newCurrentItem };
					});
					break;

				case "error":
					console.error(`[useJobProgress] Error event for job ${currentJobId}:`, event.message);
					setState((prev) => ({ ...prev, error: event.message }));
					break;
			}
		},
		[], // No dependencies - uses refs for external values
	);

	// Manage EventSource connection
	useEffect(() => {
		// Reset state when jobId changes
		setState(createInitialState());

		// Don't connect if no jobId
		if (!jobId) {
			return;
		}

		// Create EventSource connection
		const url = `/api/jobs/${jobId}/progress`;
		const eventSource = new EventSource(url);
		eventSourceRef.current = eventSource;

		// Track retry attempts to prevent infinite reconnection
		let retryCount = 0;
		const MAX_RETRIES = 5;

		// Handle connection open
		eventSource.onopen = () => {
			retryCount = 0; // Reset counter on successful connection
			setState((prev) => ({ ...prev, isConnected: true, error: null }));
		};

		// Handle incoming messages
		eventSource.onmessage = (messageEvent) => {
			const event = parseSSEEvent(messageEvent.data);
			if (event) {
				handleEvent(event, jobId);
			}
		};

		// Handle errors with circuit breaker
		eventSource.onerror = () => {
			retryCount++;

			setState((prev) => {
				// Don't overwrite actual error from SSE error event
				// Also don't show connection error if job already completed/failed
				const isTerminal = prev.status === "completed" || prev.status === "failed";
				const hasRealError = prev.error && !prev.error.includes("Connection");

				if (isTerminal || hasRealError) {
					// Job is done or has real error - just mark disconnected, keep error
					return { ...prev, isConnected: false };
				}

				if (retryCount >= MAX_RETRIES) {
					eventSource.close();
					return {
						...prev,
						isConnected: false,
						error: "Sync connection failed. Please refresh and try again.",
					};
				}

				// Still retrying
				return {
					...prev,
					isConnected: false,
					error: `Connection lost - reconnecting... (attempt ${retryCount}/${MAX_RETRIES})`,
				};
			});
		};

		// Cleanup on unmount or jobId change
		return () => {
			eventSource.close();
			eventSourceRef.current = null;
		};
	}, [jobId, handleEvent]); // handleEvent is now stable (no deps), so this only re-runs on jobId change

	return state;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get progress percentage (0-100).
 */
export function getProgressPercent(progress: JobProgressEvent | null): number {
	if (!progress || progress.total === 0) return 0;
	return Math.round((progress.done / progress.total) * 100);
}

/**
 * Check if job is in a terminal state.
 */
export function isTerminalStatus(
	status: JobStatusEvent["status"] | null,
): boolean {
	return status === "completed" || status === "failed";
}

/**
 * Get items by status.
 */
export function getItemsByStatus(
	items: Map<string, JobItemEvent>,
	status: JobItemStatus,
): JobItemEvent[] {
	return Array.from(items.values()).filter((item) => item.status === status);
}

/**
 * Calculate smooth progress percentage (0-100) using sub-phase interpolation.
 *
 * Instead of jumping 33% when each phase completes, this interpolates within
 * each phase based on item counts (e.g., 50/707 liked songs = 2.3% of phase 1).
 *
 * Phase weights (configurable):
 * - Phase 0 (liked_songs): 0-40%
 * - Phase 1 (playlists): 40-70%
 * - Phase 2 (playlist_tracks): 70-100%
 */
export function getSmoothProgressPercent(state: JobProgressState): number {
	const { progress, items, itemTotals } = state;

	// Fallback to basic progress if no phase data
	if (!progress || progress.total === 0) return 0;

	// Phase boundaries (weighted by typical time)
	const phaseWeights = [
		{ id: "liked_songs", start: 0, end: 40 },
		{ id: "playlists", start: 40, end: 70 },
		{ id: "playlist_tracks", start: 70, end: 100 },
	];

	let totalProgress = 0;

	for (let i = 0; i < phaseWeights.length; i++) {
		const phase = phaseWeights[i];
		const phaseRange = phase.end - phase.start;
		const item = items.get(phase.id);
		const discoveredTotal = itemTotals.get(phase.id) ?? 0;

		if (!item) {
			// Phase not started
			continue;
		}

		if (item.status === "succeeded") {
			// Phase complete - add full range
			totalProgress = phase.end;
		} else if (item.status === "in_progress" && discoveredTotal > 0) {
			// Phase in progress - interpolate within range
			const currentCount = item.count ?? 0;
			const subProgress = Math.min(currentCount / discoveredTotal, 1);
			totalProgress = phase.start + subProgress * phaseRange;
		} else if (item.status === "in_progress") {
			// In progress but no total yet - show start of phase
			totalProgress = phase.start;
		}
	}

	return Math.round(totalProgress);
}
