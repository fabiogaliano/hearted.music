/**
 * Workflow: stateless playlist-draft preview.
 *
 * Coordinates billing (intent eligibility), library (Phase-1 candidate
 * loading), enrichment (intent + song embeddings), and taste (scoring) to
 * assemble a preview + suggestions list. No writes — this is the read-only
 * half of the create screen's studio session; see commit.ts for the write
 * half (persisting the config + recording match decisions).
 */

import { Result } from "better-result";
import type { AdminSupabaseClient } from "@/lib/data/client";
import { readBillingStateOrFreeTier } from "@/lib/domains/billing/queries";
import { getSongEmbeddingsBatch } from "@/lib/domains/enrichment/embeddings/queries";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { loadPhase1Candidates } from "@/lib/domains/playlists/candidate-loader";
import {
	assembleDraft,
	buildProfileFromIntent,
	buildProfileFromPills,
	filterCandidates,
	scoreCandidates,
} from "@/lib/domains/playlists/draft-engine";
import { isIntentEligible } from "@/lib/domains/playlists/intent-eligibility";
import type { SongVM } from "@/lib/domains/playlists/types";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";

export interface PreviewPlaylistDraftInput {
	/** Natural-language intent phrase (premium feature — may be ignored server-side). */
	intent?: string;
	/** User-declared genre pills. */
	genrePills: string[];
	/** Hard match filters applied before scoring. */
	matchFilters: PlaylistMatchFiltersV1;
	/** Max songs in the preview (5–50, step 5). */
	maxSongs: number;
	/** Song IDs the user explicitly added — always appear first in preview. */
	pinnedSongIds: string[];
	/** Song IDs the user explicitly removed — never appear in results. */
	excludedSongIds: string[];
	/**
	 * Pages the suggestions window deeper into the ranked candidate pool.
	 * "Refresh suggestions" increments this client-side without changing any
	 * other config, so the same scored ranking yields a genuinely new batch.
	 */
	suggestionsOffset: number;
}

export interface PreviewPlaylistDraftResult {
	preview: SongVM[];
	suggestions: SongVM[];
	totalEligible: number;
	/** True when the intent phrase was applied (account is eligible + intent was provided). */
	intentApplied: boolean;
}

export async function runPreviewPlaylistDraft(
	supabase: AdminSupabaseClient,
	accountId: string,
	data: PreviewPlaylistDraftInput,
): Promise<PreviewPlaylistDraftResult> {
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

	// Apply hard filters to reduce candidates to the eligible set
	const nowMs = Date.now();
	const filteredCandidates = filterCandidates(
		candidates,
		data.matchFilters,
		nowMs,
	);

	// Build a transient (never-persisted) profile for this draft.
	// On the premium/intent path, embed the intent phrase as a query-role
	// vector and blend it into the profile so semantic ranking is active.
	// We also fetch any song embeddings that exist for the filtered candidates —
	// some users may have had songs analyzed and embedded before switching plans,
	// so the set of songs with embeddings may be non-empty even on the free tier.
	// One embedding API call per request, only when the account is eligible.
	// We intentionally skip the heavy HyDE expansion used in the managed-playlist
	// path — a raw query embedding is cheap enough for the live-preview budget.
	// On failure we degrade gracefully to the pills-only profile and mark
	// intentApplied false so the UI accurately reflects what happened.
	let profile: ReturnType<typeof buildProfileFromPills>;
	let effectiveIntentApplied = false;
	let songEmbeddingsMap: Map<string, number[]> | undefined;

	if (effectiveIntent !== null) {
		const embeddingServiceResult = EmbeddingService.create();
		if (Result.isOk(embeddingServiceResult)) {
			const embeddingService = embeddingServiceResult.value;
			const candidateIds = filteredCandidates.map((c) => c.song.id);

			// Fetch intent embedding + any available song embeddings in parallel.
			const [embeddingResult, songEmbeddingsResult] = await Promise.all([
				embeddingService.embedText(effectiveIntent, { role: "query" }),
				getSongEmbeddingsBatch(
					candidateIds,
					embeddingService.getModel(),
					"full",
				),
			]);

			if (Result.isOk(embeddingResult)) {
				profile = buildProfileFromIntent(
					filteredCandidates,
					data.genrePills,
					embeddingResult.value,
				);
				effectiveIntentApplied = true;

				// Build number[] map for scoreCandidates. Embedding vectors are stored
				// as JSON strings in the DB row; parse them here so the scorer receives
				// plain number arrays.
				if (Result.isOk(songEmbeddingsResult)) {
					songEmbeddingsMap = new Map<string, number[]>();
					for (const [songId, row] of songEmbeddingsResult.value) {
						const vec =
							typeof row.embedding === "string"
								? (JSON.parse(row.embedding) as number[])
								: (row.embedding as unknown as number[]);
						songEmbeddingsMap.set(songId, vec);
					}
				}
			} else {
				// Embedding API call failed — degrade to pills-only so the preview
				// still works, but don't claim intent was applied.
				console.error(
					"[playlist-draft] intent embedding failed, falling back to pills-only",
					embeddingResult.error,
				);
				profile = buildProfileFromPills(filteredCandidates, data.genrePills);
			}
		} else {
			// ML provider unavailable (e.g. no API key in this environment).
			// Degrade gracefully rather than throwing.
			console.error(
				"[playlist-draft] EmbeddingService unavailable, falling back to pills-only",
				embeddingServiceResult.error,
			);
			profile = buildProfileFromPills(filteredCandidates, data.genrePills);
		}
	} else {
		profile = buildProfileFromPills(filteredCandidates, data.genrePills);
	}

	// Score all eligible candidates. When intent was applied, the profile
	// carries the query embedding and songEmbeddingsMap carries per-song vectors
	// for candidates that have them; songs without embeddings fall back to
	// adaptive-weight redistribution (hasEmbedding=false path in the scorer).
	// intentApplied is only true when the intent embedding was successfully
	// built and is present in the profile.
	const scored = await scoreCandidates(
		filteredCandidates,
		profile,
		songEmbeddingsMap,
	);

	// Assemble preview + suggestions with pinned/excluded song handling
	return assembleDraft(
		scored,
		data.pinnedSongIds,
		data.excludedSongIds,
		data.maxSongs,
		effectiveIntentApplied,
		filteredCandidates,
		data.suggestionsOffset,
	);
}
