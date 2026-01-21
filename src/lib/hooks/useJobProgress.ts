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
	/** Currently processing item (status = "in_progress") */
	currentItem: JobItemEvent | null;
	/** Connection error message */
	error: string | null;
	/** Whether EventSource is connected */
	isConnected: boolean;
}

const initialState: JobProgressState = {
	progress: null,
	status: null,
	items: new Map(),
	currentItem: null,
	error: null,
	isConnected: false,
};

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
	const [state, setState] = useState<JobProgressState>(initialState);
	const queryClient = useQueryClient();
	const eventSourceRef = useRef<EventSource | null>(null);

	// Handle incoming SSE event
	const handleEvent = useCallback(
		(event: JobEvent) => {
			switch (event.type) {
				case "progress":
					setState((prev) => ({ ...prev, progress: event }));
					// Update TanStack Query cache
					if (jobId) {
						queryClient.setQueryData(["job", jobId], (old: unknown) => ({
							...(typeof old === "object" && old !== null ? old : {}),
							progress: {
								done: event.done,
								total: event.total,
								succeeded: event.succeeded,
								failed: event.failed,
							},
						}));
					}
					break;

				case "status":
					setState((prev) => ({ ...prev, status: event.status }));
					// Update TanStack Query cache
					if (jobId) {
						queryClient.setQueryData(["job", jobId], (old: unknown) => ({
							...(typeof old === "object" && old !== null ? old : {}),
							status: event.status,
						}));
					}
					// Invalidate related queries on completion
					if (event.status === "completed" || event.status === "failed") {
						queryClient.invalidateQueries({ queryKey: ["songs"] });
						queryClient.invalidateQueries({ queryKey: ["playlists"] });
					}
					break;

				case "item":
					setState((prev) => {
						const newItems = new Map(prev.items);
						newItems.set(event.itemId, event);
						const newCurrentItem =
							event.status === "in_progress" ? event : prev.currentItem;
						return { ...prev, items: newItems, currentItem: newCurrentItem };
					});
					break;

				case "error":
					setState((prev) => ({ ...prev, error: event.message }));
					break;
			}
		},
		[jobId, queryClient],
	);

	// Manage EventSource connection
	useEffect(() => {
		// Reset state when jobId changes
		setState(initialState);

		// Don't connect if no jobId
		if (!jobId) {
			return;
		}

		// Create EventSource connection
		const url = `/api/jobs/${jobId}/progress`;
		const eventSource = new EventSource(url);
		eventSourceRef.current = eventSource;

		// Handle connection open
		eventSource.onopen = () => {
			setState((prev) => ({ ...prev, isConnected: true, error: null }));
		};

		// Handle incoming messages
		eventSource.onmessage = (messageEvent) => {
			const event = parseSSEEvent(messageEvent.data);
			if (event) {
				handleEvent(event);
			}
		};

		// Handle errors
		eventSource.onerror = () => {
			setState((prev) => ({
				...prev,
				isConnected: false,
				error: "Connection lost - reconnecting...",
			}));
			// EventSource auto-reconnects, so we don't need to do anything else
		};

		// Cleanup on unmount or jobId change
		return () => {
			eventSource.close();
			eventSourceRef.current = null;
		};
	}, [jobId, handleEvent]);

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
