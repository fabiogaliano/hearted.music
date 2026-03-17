/**
 * useEnrichmentProgress - React hook for polling enrichment job progress.
 *
 * Unlike the SSE-based useJobProgress (used for sync), enrichment jobs run
 * on a background worker and don't emit real-time events. This hook polls
 * the job state at a fixed interval and stops on terminal status.
 *
 * Usage:
 *   const { status, progress, error, isLoading } = useEnrichmentProgress(enrichmentJobId)
 *
 * TODO: Wire into onboarding flow (after flag-playlists step) and dashboard to show enrichment progress
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { EnrichmentChunkProgress } from "@/lib/platform/jobs/progress/types";

export interface EnrichmentProgressState {
	jobId: string | null;
	status: "pending" | "running" | "completed" | "failed" | null;
	progress: EnrichmentChunkProgress | null;
	error: string | null;
	isLoading: boolean;
}

const POLL_INTERVAL_MS = 3_000;

const IDLE_STATE: EnrichmentProgressState = {
	jobId: null,
	status: null,
	progress: null,
	error: null,
	isLoading: false,
};

export function useEnrichmentProgress(
	enrichmentJobId: string | null | undefined,
): EnrichmentProgressState {
	const [state, setState] = useState<EnrichmentProgressState>(() =>
		enrichmentJobId
			? { ...IDLE_STATE, jobId: enrichmentJobId, isLoading: true }
			: IDLE_STATE,
	);

	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchProgress = useCallback(async (jobId: string) => {
		try {
			const response = await fetch(`/api/jobs/${jobId}/enrichment-progress`);
			if (!response.ok) {
				setState((prev) => ({
					...prev,
					error: "Failed to fetch progress",
					isLoading: false,
				}));
				return;
			}

			const data = await response.json();
			setState({
				jobId,
				status: data.status,
				progress: data.progress,
				error: data.error ?? null,
				isLoading: false,
			});
		} catch (err) {
			setState((prev) => ({
				...prev,
				error: String(err),
				isLoading: false,
			}));
		}
	}, []);

	useEffect(() => {
		if (!enrichmentJobId) {
			setState(IDLE_STATE);
			return;
		}

		setState({ ...IDLE_STATE, jobId: enrichmentJobId, isLoading: true });

		fetchProgress(enrichmentJobId);

		intervalRef.current = setInterval(() => {
			fetchProgress(enrichmentJobId);
		}, POLL_INTERVAL_MS);

		return () => {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		};
	}, [enrichmentJobId, fetchProgress]);

	// Stop polling on terminal status
	useEffect(() => {
		if (isTerminalEnrichmentStatus(state.status)) {
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
				intervalRef.current = null;
			}
		}
	}, [state.status]);

	return state;
}

export function isTerminalEnrichmentStatus(
	status: string | null | undefined,
): boolean {
	return status === "completed" || status === "failed";
}
