/**
 * Dev-only reseed helper.
 *
 * Derives owed work from current liked-song and target-playlist state
 * after a warm reset, so replay starts from real current data.
 */

import { Result } from "better-result";
import { env } from "@/env";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { getCount as getLikedSongCount } from "@/lib/domains/library/liked-songs/queries";
import { getTargetPlaylists } from "@/lib/domains/library/playlists/queries";
import { OnboardingChanges } from "../changes/onboarding";
import { applyLibraryProcessingChange } from "../service";
import type { LibraryProcessingChange } from "../types";

export interface ReseedResult {
	enrichmentRequested: boolean;
	matchRefreshRequested: boolean;
	billingSeeded: boolean;
}

/**
 * Re-seeds library-processing work from current account state.
 * Determines what work is owed based on existing liked songs and target playlists.
 */
export async function reseedAfterReset(
	accountId: string,
): Promise<ReseedResult> {
	const billingSeeded = await seedBillingState(accountId);

	const [songCountResult, targetResult] = await Promise.all([
		getLikedSongCount(accountId),
		getTargetPlaylists(accountId),
	]);

	const hasSongs = Result.isOk(songCountResult) && songCountResult.value > 0;
	const hasTargets = Result.isOk(targetResult) && targetResult.value.length > 0;

	if (!hasSongs && !hasTargets) {
		return {
			enrichmentRequested: false,
			matchRefreshRequested: false,
			billingSeeded,
		};
	}

	if (hasTargets) {
		await applyLibraryProcessingChange(
			OnboardingChanges.targetSelectionConfirmed(accountId),
		);
		return {
			enrichmentRequested: hasSongs,
			matchRefreshRequested: true,
			billingSeeded,
		};
	}

	if (hasSongs) {
		const change: LibraryProcessingChange = {
			kind: "library_synced",
			accountId,
			changes: {
				likedSongs: { added: true, removed: false },
				targetPlaylists: {
					trackMembershipChanged: false,
					profileTextChanged: false,
					removed: false,
				},
			},
		};
		await applyLibraryProcessingChange(change);
		return {
			enrichmentRequested: true,
			matchRefreshRequested: false,
			billingSeeded,
		};
	}

	return {
		enrichmentRequested: false,
		matchRefreshRequested: false,
		billingSeeded,
	};
}

async function seedBillingState(accountId: string): Promise<boolean> {
	const supabase = createAdminSupabaseClient();
	const unlimitedAccessSource = env.BILLING_ENABLED ? null : "self_hosted";

	const { error } = await supabase.from("account_billing").upsert(
		{
			account_id: accountId,
			plan: "free",
			credit_balance: 0,
			subscription_status: "none",
			cancel_at_period_end: false,
			unlimited_access_source: unlimitedAccessSource,
		},
		{ onConflict: "account_id" },
	);

	return !error;
}
