import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { dashboardKeys } from "@/features/dashboard/queries";
import { likedSongsKeys } from "@/features/liked-songs/queries";
import { matchingKeys } from "@/features/matching/queries";
import { playlistKeys } from "@/features/playlists/queries";
import { type ActiveJobs, getActiveJobs } from "@/lib/server/jobs.functions";

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;

const activeJobsKeys = {
	all: ["active-jobs"] as const,
	byAccount: (accountId: string) => ["active-jobs", accountId] as const,
};

function hasActiveJob(data: ActiveJobs | undefined): boolean {
	return !!(data?.enrichment || data?.matchSnapshotRefresh);
}

function activeJobsQueryOptions(accountId: string, enabled = true) {
	return queryOptions({
		queryKey: activeJobsKeys.byAccount(accountId),
		queryFn: () => getActiveJobs(),
		enabled,
		refetchInterval: (query) =>
			hasActiveJob(query.state.data) ? ACTIVE_POLL_MS : IDLE_POLL_MS,
	});
}

export function useActiveJobs(accountId: string, enabled = true) {
	const { data } = useQuery(activeJobsQueryOptions(accountId, enabled));

	return {
		isEnrichmentRunning: !!data?.enrichment,
		isMatchSnapshotRefreshRunning: !!data?.matchSnapshotRefresh,
		enrichmentProgress: data?.enrichment?.progress ?? null,
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
	const { data } = useQuery({
		...activeJobsQueryOptions(accountId, enabled),
		select: selectRunningJobs,
	});
	const queryClient = useQueryClient();
	const prevRef = useRef<RunningJobs | undefined>(undefined);

	useEffect(() => {
		const prev = prevRef.current;
		prevRef.current = data;

		if (!prev || !data) return;

		if (prev.enrichment && !data.enrichment) {
			queryClient.invalidateQueries({
				queryKey: dashboardKeys.pageData(accountId),
			});
			queryClient.invalidateQueries({
				queryKey: dashboardKeys.stats(accountId),
			});
			queryClient.invalidateQueries({
				queryKey: dashboardKeys.recentActivity(accountId),
			});
			queryClient.invalidateQueries({
				queryKey: likedSongsKeys.stats(accountId),
			});
			queryClient.invalidateQueries({
				queryKey: likedSongsKeys.all,
			});
		}

		if (prev.matchSnapshotRefresh && !data.matchSnapshotRefresh) {
			queryClient.invalidateQueries({
				queryKey: dashboardKeys.pageData(accountId),
			});
			queryClient.invalidateQueries({
				queryKey: dashboardKeys.matchPreviews(accountId),
			});
			// Refresh only the session summary — it drives the "new suggestions"
			// banner and the sidebar badge. Deliberately NOT matchingKeys.all: that
			// also evicts the active walk's per-song caches, abruptly interrupting an
			// in-progress session the moment a background snapshot refresh lands.
			queryClient.invalidateQueries({
				queryKey: matchingKeys.session(accountId),
			});
			queryClient.invalidateQueries({
				queryKey: playlistKeys.all,
			});
		}
	}, [data, accountId, queryClient]);
}
