import type { AdminSupabaseClient } from "@/lib/data/client";
import { BillingChanges } from "@/lib/workflows/library-processing/changes/billing";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";

interface PackFulfilledParams {
	accountId: string;
	bonusUnlockedSongIds: string[];
}

interface UnlimitedActivatedParams {
	accountId: string;
	stripeSubscriptionId: string;
	subscriptionPeriodEnd: string;
	stripeEventId: string;
}

interface PackReversedParams {
	accountId: string;
	packStripeEventId: string;
	stripeEventId: string;
	reason: "refund" | "chargeback";
}

interface UnlimitedPeriodReversedParams {
	accountId: string;
	stripeSubscriptionId: string;
	subscriptionPeriodEnd: string;
	stripeEventId: string;
	reason: "refund" | "chargeback";
}

export async function handlePackFulfilled(
	_supabase: AdminSupabaseClient,
	params: PackFulfilledParams,
): Promise<void> {
	if (params.bonusUnlockedSongIds.length === 0) {
		return;
	}

	const change = BillingChanges.songsUnlocked(
		params.accountId,
		params.bonusUnlockedSongIds,
	);
	await applyLibraryProcessingChange(change);
}

export async function handleUnlimitedActivated(
	supabase: AdminSupabaseClient,
	params: UnlimitedActivatedParams,
): Promise<void> {
	const { error } = await supabase.from("billing_activation").insert({
		account_id: params.accountId,
		kind: "unlimited_period_activated",
		stripe_subscription_id: params.stripeSubscriptionId,
		subscription_period_end: params.subscriptionPeriodEnd,
		stripe_event_id: params.stripeEventId,
	});

	if (error) {
		// UNIQUE constraint violation — duplicate activation for same period
		if (error.code === "23505") {
			return;
		}
		throw new Error(
			`[bridge-handlers] Failed to insert billing_activation: ${error.message}`,
		);
	}

	const change = BillingChanges.unlimitedActivated(params.accountId);
	await applyLibraryProcessingChange(change);
}

export async function handlePackReversed(
	supabase: AdminSupabaseClient,
	params: PackReversedParams,
): Promise<void> {
	const { data, error } = await supabase.rpc("reverse_pack_entitlement", {
		p_account_id: params.accountId,
		p_pack_stripe_event_id: params.packStripeEventId,
		p_stripe_event_id: params.stripeEventId,
		p_reason: params.reason,
	});

	if (error) {
		throw new Error(
			`[bridge-handlers] reverse_pack_entitlement failed: ${error.message}`,
		);
	}

	const result = data as {
		credits_reversed?: number;
		revoked_song_ids?: string[];
	} | null;
	const revokedCount = result?.revoked_song_ids?.length ?? 0;

	if (revokedCount > 0) {
		const change = BillingChanges.candidateAccessRevoked(params.accountId);
		await applyLibraryProcessingChange(change);
	}
}

export async function handleUnlimitedPeriodReversed(
	supabase: AdminSupabaseClient,
	params: UnlimitedPeriodReversedParams,
): Promise<void> {
	const { data, error } = await supabase.rpc(
		"reverse_unlimited_period_entitlement",
		{
			p_stripe_subscription_id: params.stripeSubscriptionId,
			p_subscription_period_end: params.subscriptionPeriodEnd,
			p_stripe_event_id: params.stripeEventId,
			p_revoked_reason: params.reason,
		},
	);

	if (error) {
		throw new Error(
			`[bridge-handlers] reverse_unlimited_period_entitlement failed: ${error.message}`,
		);
	}

	const revokedSongs = data as Array<{ song_id: string }> | null;
	if (revokedSongs && revokedSongs.length > 0) {
		const change = BillingChanges.candidateAccessRevoked(params.accountId);
		await applyLibraryProcessingChange(change);
	}
}

export async function handleSubscriptionDeactivated(
	accountId: string,
): Promise<void> {
	// Subscription deactivation means unlimited access is no longer available,
	// which changes the candidate access profile for match snapshots.
	const change = BillingChanges.candidateAccessRevoked(accountId);
	await applyLibraryProcessingChange(change);
}
