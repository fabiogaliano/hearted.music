/**
 * Unlock orchestration module.
 *
 * Centralizes the logic for unlocking songs via credit balance and
 * granting free allocations. All callers (server functions, pack
 * fulfillment, etc.) go through these functions.
 */

import { Result } from "better-result";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import { BillingChanges } from "@/lib/workflows/library-processing/changes/billing";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

export type UnlockError =
	| { kind: "insufficient_balance"; required: number; available: number }
	| { kind: "invalid_songs"; songIds: string[] }
	| { kind: "unlimited_access_active" }
	| { kind: "db_error"; cause: DbError };

export type RequestSongUnlockResult = {
	newlyUnlockedIds: string[];
	alreadyUnlockedIds: string[];
	remainingBalance: number;
};

export type GrantFreeAllocationResult = {
	unlockedIds: string[];
};

interface UnlockRpcPayload {
	newly_unlocked_song_ids: string[];
	already_unlocked_song_ids: string[];
}

function isUnlockRpcPayload(value: unknown): value is UnlockRpcPayload {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		Array.isArray(obj.newly_unlocked_song_ids) &&
		Array.isArray(obj.already_unlocked_song_ids)
	);
}

export async function requestSongUnlock(
	supabase: AdminSupabaseClient,
	accountId: string,
	songIds: string[],
): Promise<Result<RequestSongUnlockResult, UnlockError>> {
	const billingResult = await readBillingState(supabase, accountId);
	if (Result.isError(billingResult)) {
		return Result.err({ kind: "db_error", cause: billingResult.error });
	}

	const billingState = billingResult.value;

	if (hasUnlimitedAccess(billingState)) {
		return Result.err({ kind: "unlimited_access_active" });
	}

	const { data, error } = await supabase.rpc("unlock_songs_for_account", {
		p_account_id: accountId,
		p_song_ids: songIds,
	});

	if (error) {
		if (error.message.includes("insufficient balance")) {
			return Result.err({
				kind: "insufficient_balance",
				required: songIds.length,
				available: billingState.creditBalance,
			});
		}
		if (error.message.includes("not currently liked")) {
			return Result.err({ kind: "invalid_songs", songIds });
		}
		return Result.err({
			kind: "db_error",
			cause: new DatabaseError({
				code: error.code,
				message: error.message,
			}),
		});
	}

	if (!isUnlockRpcPayload(data)) {
		return Result.err({
			kind: "db_error",
			cause: new DatabaseError({
				code: "UNEXPECTED_SHAPE",
				message: "unlock_songs_for_account returned unexpected shape",
			}),
		});
	}

	const newlyUnlockedIds = data.newly_unlocked_song_ids;
	const alreadyUnlockedIds = data.already_unlocked_song_ids;
	const remainingBalance = billingState.creditBalance - newlyUnlockedIds.length;

	if (newlyUnlockedIds.length > 0) {
		try {
			await applyLibraryProcessingChange(
				BillingChanges.songsUnlocked(accountId, newlyUnlockedIds),
			);
		} catch (err) {
			console.error(
				"[unlocks] Failed to apply library processing change:",
				err,
			);
		}
	}

	return Result.ok({ newlyUnlockedIds, alreadyUnlockedIds, remainingBalance });
}

const FREE_ALLOCATION_LIMIT = 15;

export async function grantFreeAllocation(
	supabase: AdminSupabaseClient,
	accountId: string,
): Promise<Result<GrantFreeAllocationResult, UnlockError>> {
	const { data: likedSongs, error: likedError } = await supabase
		.from("liked_song")
		.select("song_id")
		.eq("account_id", accountId)
		.is("unliked_at", null)
		.order("liked_at", { ascending: false })
		.limit(FREE_ALLOCATION_LIMIT);

	if (likedError) {
		return Result.err({
			kind: "db_error",
			cause: new DatabaseError({
				code: likedError.code,
				message: likedError.message,
			}),
		});
	}

	const candidateIds = (likedSongs ?? []).map((row) => row.song_id);

	if (candidateIds.length === 0) {
		return Result.ok({ unlockedIds: [] });
	}

	const { data: unlockRows, error: unlockError } = await supabase.rpc(
		"insert_song_unlocks_without_charge",
		{
			p_account_id: accountId,
			p_song_ids: candidateIds,
			p_source: "free_auto",
		},
	);

	if (unlockError) {
		return Result.err({
			kind: "db_error",
			cause: new DatabaseError({
				code: unlockError.code,
				message: unlockError.message,
			}),
		});
	}

	const unlockedIds = (unlockRows ?? []).map((row) => row.song_id);

	if (unlockedIds.length > 0) {
		try {
			await applyLibraryProcessingChange(
				BillingChanges.songsUnlocked(accountId, unlockedIds),
			);
		} catch (err) {
			console.error(
				"[unlocks] Failed to apply library processing change for free allocation:",
				err,
			);
		}
	}

	return Result.ok({ unlockedIds });
}
