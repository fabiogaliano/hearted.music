import type { MatchOrientation } from "@/lib/domains/taste/match-review-queue/types";
import { captureProductEventBestEffort } from "@/lib/observability/capture-product-event";

/**
 * Best-effort PostHog events fired on every durable non-zero queue append.
 *
 * Matches the `onVisibleAppend` callback shape declared by the match-review-queue
 * service's AppendOpts. Shared across every server function that drives an append
 * (start/resume, background sync, filter save, filter flush) so the two emitted
 * events and their property shapes stay in lockstep — a change here reaches all
 * append sites at once instead of drifting across hand-rolled copies.
 */
export function emitQueueAppendEvents({
	orientation,
	appendedCount,
	accountId,
}: {
	orientation: MatchOrientation;
	appendedCount: number;
	accountId: string;
}): void {
	captureProductEventBestEffort({
		distinctId: accountId,
		event: "review_queue_appended",
		accountId,
		operation: "capture_review_queue_appended",
		properties: { orientation, appended_count: appendedCount },
	});
	captureProductEventBestEffort({
		distinctId: accountId,
		event: "first_visible_match_ready",
		accountId,
		operation: "capture_first_visible_match_ready",
		properties: {
			account_id: accountId,
			orientation,
			appended_count: appendedCount,
		},
	});
}
