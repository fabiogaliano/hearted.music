/**
 * Workflow: stateless playlist-draft preview.
 *
 * Coordinates billing (intent eligibility), enrichment (the intent embedding)
 * and the ranking RPC to compose a tracklist + suggestions preview. No writes —
 * this is the read-only half of the create screen's studio session; see
 * publish.ts for the write half (persisting the config + recording match
 * decisions).
 */

import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingStateOrFreeTier } from "@/lib/domains/billing/queries";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { SUGGESTIONS_COUNT } from "@/lib/domains/playlists/constants";
import type { PlaylistDraftPreview } from "@/lib/domains/playlists/draft-engine";
import { composePlaylistPreview } from "@/lib/domains/playlists/draft-engine";
import { isIntentEligible } from "@/lib/domains/playlists/intent-eligibility";
import {
	type PreviewRankInput,
	rankPreviewCandidates,
} from "@/lib/domains/playlists/preview-rank-queries";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { captureServerError } from "@/lib/observability/capture-server-error";

export interface PreviewPlaylistDraftInput {
	/** Natural-language intent phrase (premium feature — may be ignored server-side). */
	intent?: string;
	/** User-declared genre pills. */
	genrePills: string[];
	/** Hard match filters applied before scoring. */
	matchFilters: PlaylistMatchFiltersV1;
	/** Max songs in the tracklist (5–50, step 5). */
	maxSongs: number;
	/**
	 * Song IDs the user explicitly pinned (manual adds + anchor-artist songs).
	 * All are filter-exempt commitments: they always lead the tracklist, and
	 * match filters never evict them (exclusion still wins). They are scored
	 * against the filtered profile without reshaping it.
	 */
	pinnedSongIds: string[];
	/** Song IDs the user explicitly removed — never appear in results. */
	excludedSongIds: string[];
	/**
	 * Pages the suggestions window deeper into the ranked candidate pool.
	 * "Refresh suggestions" increments this client-side without changing any
	 * other config, so the same ranking yields a genuinely new batch.
	 */
	suggestionsOffset: number;
}

// The result shape is owned by the domain engine; re-exported here so the
// server-fn adapter (and through it the client) share the single definition.
export type { PlaylistDraftPreview } from "@/lib/domains/playlists/draft-engine";

/**
 * The intent embedding plus the model whose stored song vectors it is compared
 * with, or null when the intent is absent, ineligible, or cannot be embedded.
 */
async function resolveIntent(
	supabase: AdminSupabaseClient,
	accountId: string,
	intent: string | undefined,
): Promise<PreviewRankInput["intent"]> {
	const phrase = intent?.trim() ?? "";
	if (phrase.length === 0) return null;

	// Intent eligibility is always computed server-side; client input is ignored
	// when the account is not eligible (defense in depth).
	const billingState = await readBillingStateOrFreeTier(
		supabase,
		accountId,
		"preview_playlist_draft",
	);
	if (!isIntentEligible(billingState)) return null;

	// Each failure below degrades the preview silently for the user (no intent
	// ranking), so Sentry is the only place it can show up.
	const report = (error: unknown, operation: string) =>
		captureServerError(error, { operation, area: "playlists", accountId });

	const embeddingServiceResult = EmbeddingService.create();
	if (Result.isError(embeddingServiceResult)) {
		report(embeddingServiceResult.error, "preview_embedding_service");
		return null;
	}
	const embeddingService = embeddingServiceResult.value;

	const embeddingResult = await embeddingService.embedText(phrase, {
		role: "query",
	});
	if (Result.isError(embeddingResult)) {
		report(embeddingResult.error, "preview_intent_embedding");
		return null;
	}
	return {
		embedding: embeddingResult.value,
		model: embeddingService.getModel(),
	};
}

export async function runPreviewPlaylistDraft(
	supabase: AdminSupabaseClient,
	accountId: string,
	data: PreviewPlaylistDraftInput,
): Promise<PlaylistDraftPreview> {
	const intent = await resolveIntent(supabase, accountId, data.intent);

	const rankingResult = await rankPreviewCandidates(supabase, accountId, {
		matchFilters: data.matchFilters,
		genrePills: data.genrePills,
		intent,
		pinnedSongIds: data.pinnedSongIds,
		excludedSongIds: data.excludedSongIds,
		// composePlaylistPreview reads at most maxSongs ranked rows for the
		// tracklist plus one offset suggestions window after them, so this prefix
		// composes exactly like the full ranking.
		rankedLimit: data.maxSongs + data.suggestionsOffset + SUGGESTIONS_COUNT,
		now: new Date(),
	});
	if (Result.isError(rankingResult)) {
		captureServerError(rankingResult.error, {
			operation: "preview_rank_candidates",
			area: "playlists",
			accountId,
		});
		throw new Error("Failed to rank the playlist preview", {
			cause: rankingResult.error,
		});
	}
	const { ranked, pinned, totalEligible } = rankingResult.value;

	// Pinned ids absent from `pinned` (no longer liked, not Phase-1) surface via
	// droppedPinnedSongIds in composePlaylistPreview.
	return composePlaylistPreview({
		ranking: [...ranked, ...pinned],
		pinnedSongIds: data.pinnedSongIds,
		excludedSongIds: data.excludedSongIds,
		maxSongs: data.maxSongs,
		intentApplied: intent !== null,
		totalEligible,
		suggestionsOffset: data.suggestionsOffset,
	});
}
