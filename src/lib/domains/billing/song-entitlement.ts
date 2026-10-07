import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import { DatabaseError, type DbError } from "@/lib/shared/errors/database";

/**
 * `activated_unlimited` already wrote `account_item_newness` inside the RPC;
 * the other two leave newness to the caller.
 */
export type SongEntitlementOutcome =
	| { kind: "activated_unlimited" }
	| { kind: "unlocked_self_hosted" }
	| { kind: "left_locked" };

interface SubscriptionProvenance {
	stripeSubscriptionId: string;
	subscriptionPeriodEnd: string;
}

// Unlimited unlock rows record which subscription period granted them, so a
// later cancellation can revoke exactly those rows. BillingState is a UI read
// model and deliberately does not carry the Stripe subscription id.
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

async function activateUnlimitedSongs(
	supabase: AdminSupabaseClient,
	accountId: string,
): Promise<Result<SongEntitlementOutcome, DbError>> {
	const provenance = await readSubscriptionProvenance(supabase, accountId);
	if (!provenance) {
		return Result.err(
			new DatabaseError({
				code: "MISSING_SUBSCRIPTION_PROVENANCE",
				message:
					"Missing subscription provenance for unlimited account; cannot activate with proper entitlement",
			}),
		);
	}

	// Activates every analyzed liked song, not just this batch, so songs that
	// were analyzed before the subscription started are covered too.
	const { error } = await supabase.rpc("activate_unlimited_songs", {
		p_account_id: accountId,
		p_granted_stripe_subscription_id: provenance.stripeSubscriptionId,
		p_granted_subscription_period_end: provenance.subscriptionPeriodEnd,
	});
	if (error) {
		return Result.err(
			new DatabaseError({
				code: error.code,
				message: `activate_unlimited_songs RPC failed: ${error.message}`,
			}),
		);
	}

	return Result.ok({ kind: "activated_unlimited" });
}

async function unlockSelfHostedSongs(
	supabase: AdminSupabaseClient,
	accountId: string,
	songIds: string[],
): Promise<Result<SongEntitlementOutcome, DbError>> {
	const { error } = await supabase.rpc("insert_song_unlocks_without_charge", {
		p_account_id: accountId,
		p_song_ids: songIds,
		p_source: "self_hosted",
	});
	if (error) {
		return Result.err(
			new DatabaseError({
				code: error.code,
				message: `self_hosted unlock RPC failed: ${error.message}`,
			}),
		);
	}

	return Result.ok({ kind: "unlocked_self_hosted" });
}

/** Applies the account's current entitlement to newly enriched songs: unlimited subscription → activate; self-hosted → unlock without charge; otherwise leave locked. Owns the billing RPCs. */
export async function applyEntitlementToSongs(
	supabase: AdminSupabaseClient,
	accountId: string,
	songIds: string[],
): Promise<Result<SongEntitlementOutcome, DbError>> {
	const billingResult = await readBillingState(supabase, accountId);
	if (Result.isError(billingResult)) {
		const error = billingResult.error;
		return Result.err(
			new DatabaseError({
				code: error._tag === "DatabaseError" ? error.code : error._tag,
				message: `Failed to read billing state: ${error.message}`,
			}),
		);
	}

	switch (billingResult.value.unlimitedAccess.kind) {
		case "subscription":
			return activateUnlimitedSongs(supabase, accountId);
		case "self_hosted":
			return unlockSelfHostedSongs(supabase, accountId, songIds);
		case "none":
			return Result.ok({ kind: "left_locked" });
	}
}
