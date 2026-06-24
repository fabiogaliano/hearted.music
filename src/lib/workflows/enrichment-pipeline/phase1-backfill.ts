import { createAdminSupabaseClient } from "@/lib/data/client";

/**
 * Probes whether any actively-liked songs still lack Phase-1 enrichment
 * (audio features or genre tagging) for the given account.
 *
 * Does not check entitlement — Phase-1 runs for every user. Used by the
 * on-demand backfill trigger so it can short-circuit before touching the
 * library-processing state machine when there is nothing to do.
 */
export async function hasPhase1SongsNeedingEnrichment(
	accountId: string,
): Promise<boolean> {
	const supabase = createAdminSupabaseClient();

	const { data, error } = await supabase.rpc(
		"select_phase1_song_ids_needing_enrichment_work",
		{ p_account_id: accountId, p_limit: 1 },
	);

	if (error) {
		throw new Error(
			`Failed to probe Phase-1 enrichment work: ${error.message}`,
		);
	}

	return (data ?? []).length > 0;
}
