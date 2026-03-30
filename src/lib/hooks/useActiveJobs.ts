import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { dashboardKeys } from "@/features/dashboard/queries";
import { likedSongsKeys } from "@/features/liked-songs/queries";
import { matchingKeys } from "@/features/matching/queries";
import { playlistKeys } from "@/features/playlists/queries";
import { type ActiveJobs, getActiveJobs } from "@/lib/server/jobs.functions";
import { readWorkflowDevSettings } from "@/lib/workflows/library-processing/devtools/settings";

const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;

function getDevActiveJobsPollMs(): number | null {
	if (!import.meta.env.DEV) {
		return null;
	}

	return readWorkflowDevSettings().client.activeJobsPollMs;
}

const activeJobsKeys = {
	all: ["active-jobs"] as const,
	byAccount: (accountId: string) => ["active-jobs", accountId] as const,
};

function hasActiveJob(data: ActiveJobs | undefined): boolean {
	return !!(data?.enrichment || data?.matchSnapshotRefresh);
}

export function activeJobsQueryOptions(accountId: string, enabled = true) {
	return queryOptions({
		queryKey: activeJobsKeys.byAccount(accountId),
		queryFn: () => getActiveJobs(),
		enabled,
		refetchInterval: (query) => {
			const devPollMs = getDevActiveJobsPollMs();
			if (devPollMs !== null) {
				return devPollMs;
			}

			return hasActiveJob(query.state.data) ? ACTIVE_POLL_MS : IDLE_POLL_MS;
		},
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

export function useActiveJobCompletionEffects(
	accountId: string,
	enabled = true,
) {
	const { data } = useQuery(activeJobsQueryOptions(accountId, enabled));
	const queryClient = useQueryClient();
	const prevRef = useRef<ActiveJobs | undefined>(undefined);

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
			queryClient.invalidateQueries({
				queryKey: matchingKeys.session(accountId),
			});
			queryClient.invalidateQueries({
				queryKey: matchingKeys.all,
			});
			queryClient.invalidateQueries({
				queryKey: playlistKeys.all,
			});
		}
	}, [data, accountId, queryClient]);
}
