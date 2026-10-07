import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { applyEntitlementToSongs } from "@/lib/domains/billing/song-entitlement";
import { markItemsNew } from "@/lib/domains/library/liked-songs/status-queries";
import { FAILURE_CODES } from "../failure-policy";
import type { StageOutcome } from "../stage-outcomes";
import type { EnrichmentContext } from "../types";

const STAGE = "content_activation" as const;

function failAll(songIds: string[], message: string): StageOutcome {
	return {
		kind: "attempted",
		stage: STAGE,
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: [],
		failures: songIds.map((songId) => ({
			songId,
			failureCode: FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
			message,
		})),
	};
}

export async function runContentActivation(
	ctx: EnrichmentContext,
	songIds: string[],
): Promise<StageOutcome> {
	if (songIds.length === 0) {
		return { kind: "skipped", stage: STAGE, candidateSongIds: [] };
	}

	const entitlement = await applyEntitlementToSongs(
		createAdminSupabaseClient(),
		ctx.accountId,
		songIds,
	);
	if (Result.isError(entitlement)) {
		return failAll(songIds, entitlement.error.message);
	}

	// The unlimited activation RPC writes newness in the same statement.
	if (entitlement.value.kind !== "activated_unlimited") {
		const markResult = await markItemsNew(ctx.accountId, "song", songIds);
		if (Result.isError(markResult)) {
			return failAll(
				songIds,
				`account_item_newness write failed: ${markResult.error.message}`,
			);
		}
	}

	return {
		kind: "attempted",
		stage: STAGE,
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: songIds,
		failures: [],
	};
}
