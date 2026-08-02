/**
 * Workflow: stateless playlist-draft preview.
 *
 * Coordinates billing (intent eligibility), library (Phase-1 candidate
 * loading), enrichment (intent + song embeddings), and taste (ranking) to
 * compose a tracklist + suggestions preview. No writes — this is the read-only
 * half of the create screen's studio session; see publish.ts for the write
 * half (persisting the config + recording match decisions).
 */

import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingStateOrFreeTier } from "@/lib/domains/billing/queries";
import { getSongEmbeddingsBatch } from "@/lib/domains/enrichment/embeddings/queries";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { loadPhase1Candidates } from "@/lib/domains/playlists/candidate-loader";
import type { PlaylistDraftPreview } from "@/lib/domains/playlists/draft-engine";
import {
	buildDraftProfile,
	composePlaylistPreview,
	rankCandidates,
	selectEligibleCandidates,
} from "@/lib/domains/playlists/draft-engine";
import { isIntentEligible } from "@/lib/domains/playlists/intent-eligibility";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";

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

function parseStoredEmbedding(value: unknown): number[] | null {
	let parsed: unknown;
	try {
		parsed = typeof value === "string" ? JSON.parse(value) : value;
	} catch {
		return null;
	}

	if (
		!Array.isArray(parsed) ||
		!parsed.every((item) => typeof item === "number" && Number.isFinite(item))
	) {
		return null;
	}

	return parsed;
}

export async function runPreviewPlaylistDraft(
	supabase: AdminSupabaseClient,
	accountId: string,
	data: PreviewPlaylistDraftInput,
): Promise<PlaylistDraftPreview> {
	// Resolve billing state in parallel with candidate loading
	const [billingState, candidates] = await Promise.all([
		readBillingStateOrFreeTier(supabase, accountId, "preview_playlist_draft"),
		loadPhase1Candidates(accountId),
	]);

	// Intent eligibility is always computed server-side; client input is ignored
	// when the account is not eligible (defense in depth).
	const eligible = isIntentEligible(billingState);
	const effectiveIntent =
		eligible && data.intent && data.intent.trim().length > 0
			? data.intent.trim()
			: null;

	// Apply hard filters to select the eligible candidate set
	const nowMs = Date.now();
	const eligibleCandidates = selectEligibleCandidates(
		candidates,
		data.matchFilters,
		nowMs,
	);

	// Pins are filter-exempt commitments. Any still-liked Phase-1 candidate the
	// user pinned (a manual add OR an anchor-artist song) joins the set sent to
	// ranking even when the match filters would drop it — but the profile and
	// totalEligible below are built from eligibleCandidates only, so a pinned
	// exception is scored against the filtered profile without reshaping it.
	// Pinned ids that are no longer liked simply stay absent from the ranking
	// and surface via droppedPinnedSongIds in composePlaylistPreview.
	const pinnedSet = new Set(data.pinnedSongIds);
	const eligibleIds = new Set(eligibleCandidates.map((c) => c.song.id));
	const pinnedExtras =
		pinnedSet.size > 0
			? candidates.filter(
					(c) => pinnedSet.has(c.song.id) && !eligibleIds.has(c.song.id),
				)
			: [];
	const rankableCandidates =
		pinnedExtras.length > 0
			? [...eligibleCandidates, ...pinnedExtras]
			: eligibleCandidates;

	// Stored song embeddings are loaded whenever the configured service can
	// identify its model. Creating the service and reading stored vectors do not
	// make an external embedding API request; only a declared eligible intent
	// triggers embedText. The two independent reads degrade independently so a
	// failed intent embedding does not discard successfully loaded song vectors.
	let intentEmbedding: number[] | undefined;
	let songEmbeddingsMap: Map<string, number[]> | undefined;

	const embeddingServiceResult = EmbeddingService.create();
	if (Result.isOk(embeddingServiceResult)) {
		const embeddingService = embeddingServiceResult.value;
		const candidateIds = rankableCandidates.map((c) => c.song.id);
		const intentEmbeddingPromise =
			effectiveIntent === null
				? Promise.resolve(null)
				: embeddingService.embedText(effectiveIntent, { role: "query" });

		const [embeddingResult, songEmbeddingsResult] = await Promise.all([
			intentEmbeddingPromise,
			getSongEmbeddingsBatch(candidateIds, embeddingService.getModel(), "full"),
		]);

		if (Result.isOk(songEmbeddingsResult)) {
			songEmbeddingsMap = new Map<string, number[]>();
			for (const [songId, row] of songEmbeddingsResult.value) {
				const embedding = parseStoredEmbedding(row.embedding);
				if (embedding === null) {
					// One corrupt historical row must not make the whole studio unusable.
					console.error(
						"[playlist-draft] invalid stored song embedding, skipping",
						{ songId },
					);
					continue;
				}
				songEmbeddingsMap.set(songId, embedding);
			}
		}

		if (embeddingResult !== null) {
			if (Result.isOk(embeddingResult)) {
				intentEmbedding = embeddingResult.value;
			} else {
				console.error(
					"[playlist-draft] intent embedding failed, falling back to pills-only",
					embeddingResult.error,
				);
			}
		}
	} else {
		// The model is unknown when the provider is unconfigured, so stored rows
		// cannot be selected safely either.
		console.error(
			"[playlist-draft] EmbeddingService unavailable, continuing without embeddings",
			embeddingServiceResult.error,
		);
	}

	// intentApplied is only true when the intent embedding was successfully
	// built and is present in the profile.
	const profile = buildDraftProfile(
		eligibleCandidates,
		data.genrePills,
		intentEmbedding,
	);
	const intentApplied = intentEmbedding !== undefined;

	// Rank the eligible candidates plus any out-of-filter pins. The map carries
	// every stored song vector available for this model; without a query embedding
	// it does not affect ranking yet. Pinned extras can only surface as pins in
	// composePlaylistPreview — they're in pinnedSongIds by construction, so they
	// never leak into the ranked fill or suggestions.
	const ranking = await rankCandidates(
		rankableCandidates,
		profile,
		songEmbeddingsMap,
	);

	return composePlaylistPreview({
		ranking,
		pinnedSongIds: data.pinnedSongIds,
		excludedSongIds: data.excludedSongIds,
		maxSongs: data.maxSongs,
		intentApplied,
		totalEligible: eligibleCandidates.length,
		suggestionsOffset: data.suggestionsOffset,
	});
}
