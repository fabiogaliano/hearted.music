import { Result } from "better-result";
import postgres from "postgres";
import { env } from "@/env";
import { writeAccountEvent } from "@/lib/account-events/producer";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { errorMessage } from "@/lib/shared/errors/error-message";
import type { MatchOrientation, MatchReviewSession } from "./types";

const sql = postgres(env.DATABASE_URL, {
	max: 1,
	prepare: false,
	fetch_types: false,
});

export interface FinalizeAppliedAppendInput {
	accountId: string;
	orientation: MatchOrientation;
	session: MatchReviewSession;
	proposalId: string;
	snapshotId: string;
	visibilityConfigHash: string;
	appendedCount: number;
}

export interface FinalizeAppliedAppendOutcome {
	kind: "applied";
	appendedCount: number;
	sessionId: string;
}

/**
 * Records the append ledger, advances the active proposal, and writes the
 * browser wake event in one transaction. Queue item inserts happen before this
 * via idempotent RPCs; keeping the ledger and event atomic means a failed event
 * write leaves the append unrecorded so the job retry re-attempts the event.
 */
export async function finalizeAppliedAppend(
	input: FinalizeAppliedAppendInput,
): Promise<Result<FinalizeAppliedAppendOutcome, DbError>> {
	const {
		accountId,
		orientation,
		session,
		proposalId,
		snapshotId,
		visibilityConfigHash,
		appendedCount,
	} = input;

	try {
		await sql.begin(async (tx) => {
			const inserted = await tx<{ session_id: string }[]>`
				INSERT INTO match_review_session_snapshot (
					session_id,
					snapshot_id,
					appended_item_count,
					visibility_config_hash
				)
				VALUES (${session.id}, ${snapshotId}, ${appendedCount}, ${visibilityConfigHash})
				ON CONFLICT (session_id, snapshot_id, visibility_config_hash) DO NOTHING
				RETURNING session_id
			`;

			if (inserted.length === 0) return;

			if (appendedCount > 0) {
				await tx`
					UPDATE match_review_session
					SET active_proposal_id = ${proposalId}
					WHERE id = ${session.id}
				`;

				await writeAccountEvent(tx, {
					accountId,
					type: "match_deck_appended",
					payload: {
						orientation,
						sessionId: session.id,
						snapshotId,
						appendedCount,
					},
				});
			}
		});
	} catch (error) {
		return Result.err(
			new DatabaseError({
				code: "append_finalize_failed",
				message: errorMessage(error),
			}),
		);
	}

	return Result.ok({ kind: "applied", appendedCount, sessionId: session.id });
}
