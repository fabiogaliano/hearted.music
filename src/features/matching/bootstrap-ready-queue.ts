import type { QueryClient } from "@tanstack/react-query";
import { matchReviewKeys } from "@/features/matching/queries";
import type { MatchViewMode } from "@/features/matching/types";
import { startOrResumeMatchReview } from "@/lib/server/match-review-queue.functions";

/**
 * Creates (or resumes) the match review session for `mode`, then invalidates the
 * queue query so it refetches the now-existing session.
 *
 * The route loader bootstraps the queue only once, on entry. A user who opens
 * /match before the first snapshot exists (fresh first-match setup) gets no
 * session, and background refresh only syncs EXISTING sessions — so nothing ever
 * creates the queue. This is the recovery path: when a first visible match
 * becomes ready while the user waits, the component re-runs this bootstrap so the
 * queue mounts instead of stranding on the "no-context" empty state.
 *
 * Extracted from the route component so the create-then-invalidate ordering can
 * be unit-tested without a React tree, mirroring runMatchSnapshotRefreshEffects.
 */
export async function bootstrapReadyMatchQueue({
	mode,
	accountId,
	queryClient,
}: {
	mode: MatchViewMode;
	accountId: string;
	queryClient: QueryClient;
}): Promise<void> {
	// Create/resume must resolve before the refetch, or the invalidation races
	// ahead of the new session row and the queue query re-reads "no session".
	await startOrResumeMatchReview({ data: { orientation: mode } });
	queryClient.invalidateQueries({
		queryKey: matchReviewKeys.review(accountId, mode),
	});
}
