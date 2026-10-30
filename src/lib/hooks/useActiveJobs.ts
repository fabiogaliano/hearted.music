import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	activeJobsKeys,
	invalidateLibrarySyncQueries,
	invalidateMatchSnapshotQueries,
} from "@/lib/query-keys";
import { getActiveJobs } from "@/lib/server/jobs.functions";
import type { ActiveJobs } from "@/lib/workflows/library-processing/active-jobs";
import {
	accountEventsConnectionQueryOptions,
	type ConnectionState,
} from "./useAccountEvents";

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;
// A failing poll is most likely an overloaded app server, so it backs off and
// then stops instead of adding load forever; the next invalidation (a stream
// snapshot, a sync request) or remount starts it again.
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

function hasActiveJob(data: ActiveJobs | undefined): boolean {
	return !!(
		data?.enrichment ||
		data?.matchSnapshotRefresh ||
		data?.extensionSync
	);
}

// The stream sends an authoritative active-jobs snapshot when it connects, so
// the HTTP read only runs when the stream can't deliver one: it failed, was
// refused, or isn't running (onboarding, a hidden tab). Before the stream first
// reports, and while it connects, wait for it.
function streamProvidesActiveJobs(connectionState: ConnectionState): boolean {
	switch (connectionState) {
		case "idle":
		case "connecting":
		case "connected":
			return true;
		case "disconnected":
		case "error":
		case "forbidden":
			return false;
	}
}

function activeJobsQueryOptions(
	accountId: string,
	connectionState: ConnectionState,
	enabled = true,
) {
	return queryOptions({
		queryKey: activeJobsKeys.byAccount(accountId),
		queryFn: () => getActiveJobs(),
		enabled: enabled && !streamProvidesActiveJobs(connectionState),
		retry: MAX_CONSECUTIVE_POLL_FAILURES - 1,
		retryDelay: (failureCount) => IDLE_POLL_MS * 2 ** (failureCount + 1),
		refetchInterval: (query) => {
			// Error status means every retry above failed too.
			if (query.state.status === "error") return false;
			return hasActiveJob(query.state.data) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
		},
	});
}

export function useActiveJobs(accountId: string, enabled = true) {
	const { data: connectionState } = useQuery(
		accountEventsConnectionQueryOptions(accountId),
	);
	const { data } = useQuery(
		activeJobsQueryOptions(accountId, connectionState, enabled),
	);

	return {
		isEnrichmentRunning: !!data?.enrichment,
		isMatchSnapshotRefreshRunning: !!data?.matchSnapshotRefresh,
		enrichmentProgress: data?.enrichment?.progress ?? null,
		matchSnapshotRefreshProgress: data?.matchSnapshotRefresh?.progress ?? null,
		// Conservative default while the query is loading: do not claim a visible match exists until the server confirms it.
		firstVisibleMatchReady: data?.firstVisibleMatchReady ?? false,
	};
}

interface RunningJobs {
	enrichment: boolean;
	matchSnapshotRefresh: boolean;
	extensionSync: boolean;
}

const selectRunningJobs = (data: ActiveJobs | undefined): RunningJobs => ({
	enrichment: !!data?.enrichment,
	matchSnapshotRefresh: !!data?.matchSnapshotRefresh,
	extensionSync: !!data?.extensionSync,
});

export function useActiveJobCompletionEffects(
	accountId: string,
	enabled = true,
) {
	const { data: connectionState } = useQuery(
		accountEventsConnectionQueryOptions(accountId),
	);
	const { data } = useQuery({
		...activeJobsQueryOptions(accountId, connectionState, enabled),
		select: selectRunningJobs,
	});
	const queryClient = useQueryClient();
	const prevRef = useRef<RunningJobs | undefined>(undefined);

	useEffect(() => {
		const prev = prevRef.current;
		prevRef.current = data;

		if (!prev || !data) return;

		if (prev.matchSnapshotRefresh && !data.matchSnapshotRefresh) {
			void invalidateMatchSnapshotQueries(queryClient, accountId);
		}
		if (prev.extensionSync && !data.extensionSync) {
			void invalidateLibrarySyncQueries(queryClient, accountId);
		}
	}, [data, accountId, queryClient]);
}
