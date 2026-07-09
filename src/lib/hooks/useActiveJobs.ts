import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { runMatchSnapshotRefreshEffects } from "@/features/matching/queries";
import { type ActiveJobs, getActiveJobs } from "@/lib/server/jobs.functions";
import {
	accountEventsConnectionKey,
	type ConnectionState,
} from "./useAccountEvents";

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;

const activeJobsKeys = {
	all: ["active-jobs"] as const,
	byAccount: (accountId: string) => ["active-jobs", accountId] as const,
};

function hasActiveJob(data: ActiveJobs | undefined): boolean {
	return !!(data?.enrichment || data?.matchSnapshotRefresh);
}

function activeJobsQueryOptions(
	accountId: string,
	connectionState: ConnectionState,
	enabled = true,
) {
	return queryOptions({
		queryKey: activeJobsKeys.byAccount(accountId),
		queryFn: () => getActiveJobs(),
		enabled,
		refetchInterval: (query) => {
			if (connectionState === "connected") return false;
			return hasActiveJob(query.state.data) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
		},
	});
}

export function useActiveJobs(accountId: string, enabled = true) {
	const { data: connectionState } = useQuery<ConnectionState>({
		queryKey: accountEventsConnectionKey(accountId),
		queryFn: () => "disconnected",
		initialData: "disconnected",
		staleTime: Number.POSITIVE_INFINITY,
	});
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
}

const selectRunningJobs = (data: ActiveJobs | undefined): RunningJobs => ({
	enrichment: !!data?.enrichment,
	matchSnapshotRefresh: !!data?.matchSnapshotRefresh,
});

export function useActiveJobCompletionEffects(
	accountId: string,
	enabled = true,
) {
	const { data: connectionState } = useQuery<ConnectionState>({
		queryKey: accountEventsConnectionKey(accountId),
		queryFn: () => "disconnected",
		initialData: "disconnected",
		staleTime: Number.POSITIVE_INFINITY,
	});
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
			void runMatchSnapshotRefreshEffects(queryClient, accountId);
		}
	}, [data, accountId, queryClient]);
}
