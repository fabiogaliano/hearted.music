import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { BillingChanges } from "@/lib/workflows/library-processing/changes";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import type { LibraryProcessingChange } from "@/lib/workflows/library-processing/types";

// Throws on apply failure so the bridge route marks the event failed and the
// upstream retries it. applyLibraryProcessingChange is reconciler-based, so
// re-running it on retry is idempotent.
async function applyChangeOrThrow(
	change: LibraryProcessingChange,
): Promise<void> {
	const applyResult = await applyLibraryProcessingChange(change);
	if (Result.isError(applyResult)) {
		throw new Error(
			`[bridge-handlers] library-processing apply failed (${applyResult.error.kind}): ${JSON.stringify(applyResult.error)}`,
		);
	}
}

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

	await applyChangeOrThrow(
		BillingChanges.songsUnlocked(params.accountId, params.bonusUnlockedSongIds),
	);
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

	// UNIQUE constraint violation (23505) means the activation marker already
	// exists — likely a retry after a partial failure. Fall through and
	// re-apply the library-processing change anyway: the reconciler is
	// idempotent, and skipping it here would leave a retry that failed after
	// the insert with no way to ever drive the downstream effects.
	if (error && error.code !== "23505") {
		throw new Error(
			`[bridge-handlers] Failed to insert billing_activation: ${error.message}`,
		);
	}

	await applyChangeOrThrow(BillingChanges.unlimitedActivated(params.accountId));
}

export async function handlePackReversed(
	params: PackReversedParams,
): Promise<void> {
	if (!params.accessRemoved) {
		return;
	}

	await applyChangeOrThrow(
		BillingChanges.candidateAccessRevoked(params.accountId),
	);
}

export async function handleUnlimitedPeriodReversed(
	params: UnlimitedPeriodReversedParams,
): Promise<void> {
	if (!params.accessRemoved) {
		return;
	}

	await applyChangeOrThrow(
		BillingChanges.candidateAccessRevoked(params.accountId),
	);
}

export async function handleSubscriptionDeactivated(
	accountId: string,
): Promise<void> {
	// Subscription deactivation means unlimited access is no longer available,
	// which changes the candidate access profile for match snapshots.
	await applyChangeOrThrow(BillingChanges.candidateAccessRevoked(accountId));
}
