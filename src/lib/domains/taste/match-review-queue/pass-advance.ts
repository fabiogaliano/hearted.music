/**
 * Owns the three-branch decision tree executed whenever an active session
 * already exists at queue entry or background sync time.
 *
 * Branch selection:
 *  1. Unresolved items remain          → append the latest snapshot in-place
 *  2. Session has not been seeded yet  → append (don't roll over; the creator
 *     is mid-seed and completing here would race its first append)
 *  3. Pass is fully caught-up          → complete the session, then create a
 *     fresh one from the latest snapshot
 *
 * INVARIANT: completeSession must transition the session out of 'active'
 * BEFORE the insert of the new active row. The partial unique index
 * idx_match_review_session_one_active rejects a second active row, so the
 * complete call in branch 3 happens inside this module before the
 * createQueueFromLatestSnapshot call that inserts the new session.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { completeSession, countUnresolvedItems } from "./queries";
import type {
	ActiveQueueResult,
	AppendResult,
	MatchReviewSession,
} from "./types";

export type PassAdvanceResult =
	| {
			kind: "resumed-in-place";
			session: MatchReviewSession;
			appendResult: AppendResult;
	  }
	| {
			kind: "appended-while-seeding";
			session: MatchReviewSession;
			appendResult: AppendResult;
	  }
	| { kind: "rolled-over-and-created"; freshQueueResult: ActiveQueueResult };

/**
 * Runs the pass-advance decision tree for an already-active session.
 *
 * `appendLatestSnapshot` and `createQueueFromLatestSnapshot` are injected so
 * this module stays free of circular imports (both live in service.ts which
 * imports pass-advance.ts).
 */
export async function advanceActiveSession(
	session: MatchReviewSession,
	accountId: string,
	appendLatestSnapshot: (
		session: MatchReviewSession,
		accountId: string,
	) => Promise<Result<AppendResult, DbError>>,
	hasSessionBeenSeeded: (
		sessionId: string,
	) => Promise<Result<boolean, DbError>>,
	createQueueFromLatestSnapshot: (
		accountId: string,
	) => Promise<Result<ActiveQueueResult, DbError>>,
): Promise<Result<PassAdvanceResult, DbError>> {
	const unresolvedResult = await countUnresolvedItems(session.id);
	if (Result.isError(unresolvedResult)) return unresolvedResult;

	if (unresolvedResult.value > 0) {
		const appendResult = await appendLatestSnapshot(session, accountId);
		if (Result.isError(appendResult)) return appendResult;
		return Result.ok<PassAdvanceResult, DbError>({
			kind: "resumed-in-place",
			session,
			appendResult: appendResult.value,
		});
	}

	const seededResult = await hasSessionBeenSeeded(session.id);
	if (Result.isError(seededResult)) return seededResult;

	if (!seededResult.value) {
		const appendResult = await appendLatestSnapshot(session, accountId);
		if (Result.isError(appendResult)) return appendResult;
		return Result.ok<PassAdvanceResult, DbError>({
			kind: "appended-while-seeding",
			session,
			appendResult: appendResult.value,
		});
	}

	// Pass is caught-up. Complete BEFORE creating the new active row so the
	// partial unique index idx_match_review_session_one_active never sees two
	// active rows simultaneously.
	const completeResult = await completeSession(session.id, accountId);
	if (Result.isError(completeResult)) return completeResult;

	const freshQueueResult = await createQueueFromLatestSnapshot(accountId);
	if (Result.isError(freshQueueResult)) return freshQueueResult;

	return Result.ok<PassAdvanceResult, DbError>({
		kind: "rolled-over-and-created",
		freshQueueResult: freshQueueResult.value,
	});
}
