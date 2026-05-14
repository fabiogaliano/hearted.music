/**
 * Replacement-credit compensation for terminal song-analysis failures.
 *
 * Wraps the `grant_analysis_failure_replacement_credit` RPC, which is itself
 * idempotent (single tx, gated by `UNIQUE(account_id, song_id, failure_code)`
 * on `song_failure_compensation`). This module just gives callers a typed
 * Result-shaped surface so they don't have to validate the JSONB payload.
 *
 * Eligibility (enforced server-side):
 *   - `failureCode === 'analysis_inputs_missing'`
 *   - active unlock with `source='pack'` and `revoked_at IS NULL` exists
 *
 * Outcomes:
 *   - granted             → credit balance incremented by 1
 *   - already_compensated → no-op (we've paid this song before)
 *   - not_eligible        → wrong failure code or no active pack unlock
 */

import { Result } from "better-result";
import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";

type CompensationOutcome =
	| { kind: "granted"; credits: number; newBalance: number }
	| { kind: "already_compensated" }
	| { kind: "not_eligible" };

const grantedSchema = z.object({
	status: z.literal("granted"),
	credits: z.number().int(),
	new_balance: z.number().int(),
});

const alreadyCompensatedSchema = z.object({
	status: z.literal("already_compensated"),
});

const notEligibleSchema = z.object({
	status: z.literal("not_eligible"),
});

const compensationPayloadSchema = z.union([
	grantedSchema,
	alreadyCompensatedSchema,
	notEligibleSchema,
]);

export async function grantAnalysisFailureReplacementCredit(
	supabase: AdminSupabaseClient,
	params: {
		accountId: string;
		songId: string;
		failureCode: string;
	},
): Promise<Result<CompensationOutcome, DbError>> {
	const { data, error } = await supabase.rpc(
		"grant_analysis_failure_replacement_credit",
		{
			p_account_id: params.accountId,
			p_song_id: params.songId,
			p_failure_code: params.failureCode,
		},
	);

	if (error) {
		return Result.err(
			new DatabaseError({ code: error.code, message: error.message }),
		);
	}

	const parsed = compensationPayloadSchema.safeParse(data);
	if (!parsed.success) {
		return Result.err(
			new DatabaseError({
				code: "UNEXPECTED_SHAPE",
				message:
					"grant_analysis_failure_replacement_credit returned unexpected shape",
			}),
		);
	}

	const payload = parsed.data;
	if (payload.status === "granted") {
		return Result.ok({
			kind: "granted",
			credits: payload.credits,
			newBalance: payload.new_balance,
		});
	}
	if (payload.status === "already_compensated") {
		return Result.ok({ kind: "already_compensated" });
	}
	return Result.ok({ kind: "not_eligible" });
}
