import {
	type QueryClient,
	queryOptions,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { dashboardKeys } from "@/features/dashboard/queries";
import { likedSongsKeys } from "@/features/liked-songs/queries";
import {
	matchReviewKeys,
	matchReviewSummaryKeys,
} from "@/features/matching/queries";
import { type ActiveJobs, getActiveJobs } from "@/lib/server/jobs.functions";
import { syncActiveMatchReviewSession } from "@/lib/server/match-review-queue.functions";

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

// Extracted so the invalidation sequence can be unit-tested without a
// running React tree or real timers. The hook's falling-edge branch delegates
// entirely to this function; runtime behavior is identical to the previous
// inline async IIFE.
export async function runMatchSnapshotRefreshEffects(
	queryClient: QueryClient,
	accountId: string,
): Promise<void> {
	// Sync must complete before the queue query refetches so the new tail
	// is already in the DB when matchReviewKeys.review invalidation fires.
	// Failure is swallowed: a missed sync just means no new items this
	// round; the user won't lose existing cards.
	try {
		await syncActiveMatchReviewSession();
	} catch {
		// Best-effort — proceed to invalidations regardless.
	}

	// Invalidate the queue summary/list so the card stack picks up
	// newly appended items.
	queryClient.invalidateQueries({
		queryKey: matchReviewKeys.review(accountId),
	});

	// Per-card item queries must NOT be invalidated here — refetching an
	// individual card mid-review would interrupt the user's current card.
	// matchReviewKeys.item is intentionally absent from this block.

	// Queue-aware summary: drives sidebar badge + dashboard CTA count after
	// Phase 7. Both surfaces now read matchReviewSummaryKeys.summary so a
	// single invalidation here keeps them consistent.
	queryClient.invalidateQueries({
		queryKey: matchReviewSummaryKeys.summary(accountId),
	});

	// Dashboard surfaces updated by the new snapshot. stats backs the CTA's
	// reviewCount — without invalidating it the preview fan refreshes while the
	// count stays stale. pageData keeps the route-loader cache fresh.
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.stats(accountId),
	});
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.pageData(accountId),
	});
	queryClient.invalidateQueries({
		queryKey: dashboardKeys.matchPreviews(accountId),
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
			void runMatchSnapshotRefreshEffects(queryClient, accountId);
		}
	}, [data, accountId, queryClient]);
}
