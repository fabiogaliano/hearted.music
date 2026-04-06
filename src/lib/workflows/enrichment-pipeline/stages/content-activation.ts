import { Result } from "better-result";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import { markItemsNew } from "@/lib/domains/library/liked-songs/status-queries";
import type { EnrichmentContext } from "../types";

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

async function activateForUnlimitedSubscription(
	supabase: AdminSupabaseClient,
	accountId: string,
	songIds: string[],
): Promise<void> {
	const provenance = await readSubscriptionProvenance(supabase, accountId);
	if (!provenance) {
		console.error(
			`[content-activation] Missing subscription provenance for unlimited account ${accountId}; falling back to item_status only`,
		);
		await markItemsNew(accountId, "song", songIds);
		return;
	}

	const { error } = await supabase.rpc("activate_unlimited_songs", {
		p_account_id: accountId,
		p_granted_stripe_subscription_id: provenance.stripeSubscriptionId,
		p_granted_subscription_period_end: provenance.subscriptionPeriodEnd,
	});

	if (error) {
		console.error(
			`[content-activation] activate_unlimited_songs failed for ${accountId}: ${error.message}`,
		);
	}
}

async function activateForSelfHosted(
	supabase: AdminSupabaseClient,
	accountId: string,
	songIds: string[],
): Promise<void> {
	await markItemsNew(accountId, "song", songIds);

	const { error } = await supabase.rpc("insert_song_unlocks_without_charge", {
		p_account_id: accountId,
		p_song_ids: songIds,
		p_source: "self_hosted",
	});

	if (error) {
		console.error(
			`[content-activation] self_hosted unlock failed for ${accountId}: ${error.message}`,
		);
	}
}

/**
 * Content activation stage: writes `item_status` and persists durable unlock
 * rows for songs that became account-visible (entitled + song_analysis exists).
 *
 * - Unlimited subscription: calls `activate_unlimited_songs` RPC (handles both
 *   item_status and unlock rows with subscription provenance)
 * - Self-hosted: writes item_status + unlock rows with source='self_hosted'
 * - Free/pack: writes item_status only (unlock rows already exist from purchase)
 */
export async function runContentActivation(
	ctx: EnrichmentContext,
	songIds: string[],
): Promise<void> {
	if (songIds.length === 0) return;

	const supabase = createAdminSupabaseClient();
	const billingResult = await readBillingState(supabase, ctx.accountId);

	if (Result.isError(billingResult)) {
		console.error(
			`[content-activation] Failed to read billing state for ${ctx.accountId}: ${billingResult.error.message}`,
		);
		return;
	}

	const billing = billingResult.value;

	switch (billing.unlimitedAccess.kind) {
		case "subscription":
			await activateForUnlimitedSubscription(supabase, ctx.accountId, songIds);
			break;
		case "self_hosted":
			await activateForSelfHosted(supabase, ctx.accountId, songIds);
			break;
		case "none":
			await markItemsNew(ctx.accountId, "song", songIds);
			break;
	}
}
