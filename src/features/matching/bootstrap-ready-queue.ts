import type { QueryClient } from "@tanstack/react-query";
import { matchReviewKeys } from "@/features/matching/queries";
import type { MatchViewMode } from "@/features/matching/types";
import { startOrResumeMatchReview } from "@/lib/server/match-review-queue.functions";

// Capped exponential backoff between recovery attempts: 2s, 4s, 8s, 16s, 30s…
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 30_000;

/** Backoff before the (attempt+1)-th retry. Exported for unit testing. */
export function bootstrapRetryDelayMs(attempt: number): number {
	return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * Creates (or resumes) the match review session for `mode`, then invalidates the
 * queue query so it refetches the now-existing session.
 *
 * The route loader bootstraps the queue only once, on entry. A user who opens
 * /match before the first snapshot exists (fresh first-match setup) gets no
 * session, and background refresh only syncs EXISTING sessions — so nothing ever
 * creates the queue. This is the recovery path: when a first visible match
 * becomes ready while the user waits, the component runs this bootstrap so the
 * queue mounts instead of stranding on the "no-context" empty state.
 *
 * The retry loop lives here (not in the calling effect) because a create/resume
 * failure would otherwise leave the user stuck on "building" with no retry: an
 * effect mutating a ref in its catch can't re-trigger a render, and the effect
 * deps don't change. Retrying with capped backoff until the session is created —
 * or the caller aborts on unmount / when the stranded condition clears — keeps a
 * transient failure from becoming a dead end, and keeps the create-then-
 * invalidate ordering unit-testable without a React tree.
 */
export async function bootstrapReadyMatchQueue({
	mode,
	accountId,
	queryClient,
	signal,
	sleep = defaultSleep,
}: {
	mode: MatchViewMode;
	accountId: string;
	queryClient: QueryClient;
	signal?: AbortSignal;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		if (signal?.aborted) return;
		try {
			// Create/resume must resolve before the refetch, or the invalidation races
			// ahead of the new session row and the queue query re-reads "no session".
			await startOrResumeMatchReview({ data: { orientation: mode } });
			queryClient.invalidateQueries({
				queryKey: matchReviewKeys.review(accountId, mode),
			});
			return;
		} catch {
			await sleep(bootstrapRetryDelayMs(attempt), signal);
		}
	}
}
