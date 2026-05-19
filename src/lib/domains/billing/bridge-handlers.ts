import { Result } from "better-result";
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
	accessRemoved: boolean;
}

interface UnlimitedPeriodReversedParams {
	accountId: string;
	accessRemoved: boolean;
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
	const applyResult = await applyLibraryProcessingChange(change);
	if (Result.isError(applyResult)) {
		console.error(
			"[bridge-handlers] library-processing apply failed:",
			applyResult.error,
		);
	}
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
	const applyResult = await applyLibraryProcessingChange(change);
	if (Result.isError(applyResult)) {
		console.error(
			"[bridge-handlers] library-processing apply failed:",
			applyResult.error,
		);
	}
}

export async function handlePackReversed(
	params: PackReversedParams,
): Promise<void> {
	if (!params.accessRemoved) {
		return;
	}

	const change = BillingChanges.candidateAccessRevoked(params.accountId);
	const applyResult = await applyLibraryProcessingChange(change);
	if (Result.isError(applyResult)) {
		console.error(
			"[bridge-handlers] library-processing apply failed:",
			applyResult.error,
		);
	}
}

export async function handleUnlimitedPeriodReversed(
	params: UnlimitedPeriodReversedParams,
): Promise<void> {
	if (!params.accessRemoved) {
		return;
	}

	const change = BillingChanges.candidateAccessRevoked(params.accountId);
	const applyResult = await applyLibraryProcessingChange(change);
	if (Result.isError(applyResult)) {
		console.error(
			"[bridge-handlers] library-processing apply failed:",
			applyResult.error,
		);
	}
}

export async function handleSubscriptionDeactivated(
	accountId: string,
): Promise<void> {
	// Subscription deactivation means unlimited access is no longer available,
	// which changes the candidate access profile for match snapshots.
	const change = BillingChanges.candidateAccessRevoked(accountId);
	const applyResult = await applyLibraryProcessingChange(change);
	if (Result.isError(applyResult)) {
		console.error(
			"[bridge-handlers] library-processing apply failed:",
			applyResult.error,
		);
	}
}
