/**
 * Unlock orchestration module.
 *
 * Centralizes the logic for unlocking songs via credit balance and
 * granting free allocations. All callers (server functions, pack
 * fulfillment, etc.) go through these functions.
 */

import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import { hasUnlimitedAccess } from "@/lib/domains/billing/state";
import type { DbError } from "@/lib/shared/errors/database";
import { DatabaseError } from "@/lib/shared/errors/database";
import { BillingChanges } from "@/lib/workflows/library-processing/changes/billing";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

type UnlockError =
	| { kind: "insufficient_balance"; required: number; available: number }
	| { kind: "invalid_songs"; songIds: string[] }
	| { kind: "unlimited_access_active" }
	| { kind: "db_error"; cause: DbError };

type RequestSongUnlockResult = {
	newlyUnlockedIds: string[];
	alreadyUnlockedIds: string[];
	remainingBalance: number;
};

type GrantFreeAllocationResult = {
	unlockedIds: string[];
};

type UnlockRpcPayload =
	| {
			status: "ok";
			newly_unlocked_song_ids: string[];
			already_unlocked_song_ids: string[];
			credit_balance: number;
	  }
	| {
			status: "insufficient_balance";
			required_credits: number;
			available_credits: number;
	  };

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function parseUnlockRpcPayload(value: unknown): UnlockRpcPayload | null {
	if (typeof value !== "object" || value === null) return null;
	const obj = value as Record<string, unknown>;
	if (obj.status === "ok") {
		if (
			isStringArray(obj.newly_unlocked_song_ids) &&
			isStringArray(obj.already_unlocked_song_ids) &&
			typeof obj.credit_balance === "number"
		) {
			return {
				status: "ok",
				newly_unlocked_song_ids: obj.newly_unlocked_song_ids,
				already_unlocked_song_ids: obj.already_unlocked_song_ids,
				credit_balance: obj.credit_balance,
			};
		}
		return null;
	}
	if (obj.status === "insufficient_balance") {
		if (
			typeof obj.required_credits === "number" &&
			typeof obj.available_credits === "number"
		) {
			return {
				status: "insufficient_balance",
				required_credits: obj.required_credits,
				available_credits: obj.available_credits,
			};
		}
		return null;
	}
	return null;
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

	const payload = parseUnlockRpcPayload(data);
	if (payload === null) {
		return Result.err({
			kind: "db_error",
			cause: new DatabaseError({
				code: "UNEXPECTED_SHAPE",
				message: "unlock_songs_for_account returned unexpected shape",
			}),
		});
	}

	if (payload.status === "insufficient_balance") {
		return Result.err({
			kind: "insufficient_balance",
			required: payload.required_credits,
			available: payload.available_credits,
		});
	}

	const newlyUnlockedIds = payload.newly_unlocked_song_ids;
	const alreadyUnlockedIds = payload.already_unlocked_song_ids;
	const remainingBalance = payload.credit_balance;

	if (newlyUnlockedIds.length > 0) {
		const applyResult = await applyLibraryProcessingChange(
			BillingChanges.songsUnlocked(accountId, newlyUnlockedIds),
		);
		if (Result.isError(applyResult)) {
			console.error(
				"[unlocks] Failed to apply library processing change:",
				applyResult.error,
			);
		}
	}

	return Result.ok({ newlyUnlockedIds, alreadyUnlockedIds, remainingBalance });
}

const FREE_ALLOCATION_LIMIT = 10;

export async function grantFreeAllocation(
	supabase: AdminSupabaseClient,
	accountId: string,
): Promise<Result<GrantFreeAllocationResult, UnlockError>> {
	const { data: activeUnlocks, error: activeUnlocksError } = await supabase
		.from("account_song_unlock")
		.select("song_id")
		.eq("account_id", accountId)
		.is("revoked_at", null);

	if (activeUnlocksError) {
		return Result.err({
			kind: "db_error",
			cause: new DatabaseError({
				code: activeUnlocksError.code,
				message: activeUnlocksError.message,
			}),
		});
	}

	const activeSongIds = new Set(
		(activeUnlocks ?? []).map((row) => row.song_id),
	);
	const missingUnlocks = FREE_ALLOCATION_LIMIT - activeSongIds.size;
	if (missingUnlocks <= 0) {
		return Result.ok({ unlockedIds: [] });
	}

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

	const candidateIds = (likedSongs ?? [])
		.map((row) => row.song_id)
		.filter((songId) => !activeSongIds.has(songId))
		.slice(0, missingUnlocks);

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
		const applyResult = await applyLibraryProcessingChange(
			BillingChanges.songsUnlocked(accountId, unlockedIds),
		);
		if (Result.isError(applyResult)) {
			console.error(
				"[unlocks] Failed to apply library processing change for free allocation:",
				applyResult.error,
			);
		}
	}

	return Result.ok({ unlockedIds });
}
