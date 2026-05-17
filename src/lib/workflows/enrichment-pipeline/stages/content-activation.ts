import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import { markItemsNew } from "@/lib/domains/library/liked-songs/status-queries";
import { FAILURE_CODES } from "../failure-policy";
import type { StageFailure, StageOutcome } from "../stage-outcomes";
import type { EnrichmentContext } from "../types";

const STAGE = "content_activation" as const;

interface SubscriptionProvenance {
	stripeSubscriptionId: string;
	subscriptionPeriodEnd: string;
}

async function readSubscriptionProvenance(
	supabase: AdminSupabaseClient,
	accountId: string,
): Promise<SubscriptionProvenance | null> {
	const { data, error } = await supabase
		.from("account_billing")
		.select("stripe_subscription_id, subscription_period_end")
		.eq("account_id", accountId)
		.single();

	if (error || !data) return null;
	if (!data.stripe_subscription_id || !data.subscription_period_end)
		return null;

	return {
		stripeSubscriptionId: data.stripe_subscription_id,
		subscriptionPeriodEnd: data.subscription_period_end,
	};
}

interface ActivationResult {
	succeededSongIds: string[];
	failures: StageFailure[];
}

async function activateForUnlimitedSubscription(
	supabase: AdminSupabaseClient,
	accountId: string,
	songIds: string[],
): Promise<ActivationResult> {
	const provenance = await readSubscriptionProvenance(supabase, accountId);
	if (!provenance) {
		return {
			succeededSongIds: [],
			failures: songIds.map((songId) => ({
				songId,
				failureCode: FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
				message:
					"Missing subscription provenance for unlimited account; cannot activate with proper entitlement",
			})),
		};
	}

	const { error } = await supabase.rpc("activate_unlimited_songs", {
		p_account_id: accountId,
		p_granted_stripe_subscription_id: provenance.stripeSubscriptionId,
		p_granted_subscription_period_end: provenance.subscriptionPeriodEnd,
	});

	if (error) {
		return {
			succeededSongIds: [],
			failures: songIds.map((songId) => ({
				songId,
				failureCode: FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
				message: `activate_unlimited_songs RPC failed: ${error.message}`,
			})),
		};
	}

	return { succeededSongIds: songIds, failures: [] };
}

async function activateForSelfHosted(
	supabase: AdminSupabaseClient,
	accountId: string,
	songIds: string[],
): Promise<ActivationResult> {
	const { error } = await supabase.rpc("insert_song_unlocks_without_charge", {
		p_account_id: accountId,
		p_song_ids: songIds,
		p_source: "self_hosted",
	});

	if (error) {
		return {
			succeededSongIds: [],
			failures: songIds.map((songId) => ({
				songId,
				failureCode: FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
				message: `self_hosted unlock RPC failed: ${error.message}`,
			})),
		};
	}

	const markResult = await markItemsNew(accountId, "song", songIds);
	if (Result.isError(markResult)) {
		return {
			succeededSongIds: [],
			failures: songIds.map((songId) => ({
				songId,
				failureCode: FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
				message: `account_item_newness write failed: ${markResult.error.message}`,
			})),
		};
	}

	return { succeededSongIds: songIds, failures: [] };
}

async function activateForFreeOrPack(
	accountId: string,
	songIds: string[],
): Promise<ActivationResult> {
	const markResult = await markItemsNew(accountId, "song", songIds);
	if (Result.isError(markResult)) {
		return {
			succeededSongIds: [],
			failures: songIds.map((songId) => ({
				songId,
				failureCode: FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
				message: `account_item_newness write failed: ${markResult.error.message}`,
			})),
		};
	}

	return { succeededSongIds: songIds, failures: [] };
}

export async function runContentActivation(
	ctx: EnrichmentContext,
	songIds: string[],
): Promise<StageOutcome> {
	if (songIds.length === 0) {
		return { kind: "skipped", stage: STAGE, candidateSongIds: [] };
	}

	const supabase = createAdminSupabaseClient();
	const billingResult = await readBillingState(supabase, ctx.accountId);

	if (Result.isError(billingResult)) {
		return {
			kind: "attempted",
			stage: STAGE,
			candidateSongIds: songIds,
			attemptedSongIds: songIds,
			succeededSongIds: [],
			failures: songIds.map((songId) => ({
				songId,
				failureCode: FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
				message: `Failed to read billing state: ${billingResult.error.message}`,
			})),
		};
	}

	const billing = billingResult.value;
	let result: ActivationResult;

	switch (billing.unlimitedAccess.kind) {
		case "subscription":
			result = await activateForUnlimitedSubscription(
				supabase,
				ctx.accountId,
				songIds,
			);
			break;
		case "self_hosted":
			result = await activateForSelfHosted(supabase, ctx.accountId, songIds);
			break;
		case "none":
			result = await activateForFreeOrPack(ctx.accountId, songIds);
			break;
	}

	return {
		kind: "attempted",
		stage: STAGE,
		candidateSongIds: songIds,
		attemptedSongIds: songIds,
		succeededSongIds: result.succeededSongIds,
		failures: result.failures,
	};
}
