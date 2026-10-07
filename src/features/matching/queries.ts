import { queryOptions } from "@tanstack/react-query";
import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import { matchReviewSummaryKeys } from "@/lib/query-keys";
import {
	getMatchReviewSummary,
	getPreferredMatchReviewSummary,
} from "@/lib/server/match-review-queue.functions";

export function matchReviewSummaryQueryOptions(
	accountId: string,
	orientation: MatchOrientation,
) {
	return queryOptions({
		queryKey: matchReviewSummaryKeys.summary(accountId, orientation),
		queryFn: () => getMatchReviewSummary({ data: { orientation } }),
		staleTime: 60_000,
	});
}

/**
 * Query options for the preference-driven summary.
 * The server function reads match_view_mode from user_preferences and delegates
 * to the appropriate orientation summary — no orientation param needed here.
 * Invalidate matchReviewSummaryKeys.preferredSummary(accountId) and
 * dashboardKeys.pageData(accountId) after a successful preference update.
 */
export function preferredMatchReviewSummaryQueryOptions(accountId: string) {
	return queryOptions({
		queryKey: matchReviewSummaryKeys.preferredSummary(accountId),
		queryFn: () => getPreferredMatchReviewSummary({ data: undefined }),
		staleTime: 60_000,
	});
}
