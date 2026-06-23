/**
 * Server functions for the stateless playlist creation preview engine.
 *
 * previewPlaylistDraft is the sole entry point: it validates input, resolves
 * the account's billing/eligibility context, and delegates all scoring and
 * ranking logic to the pure domain functions in src/lib/domains/playlists/.
 *
 * No playlist rows, snapshot rows, or profile rows are written here.
 * Everything is computed in-memory and discarded after the response.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
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
import {
	getUnlockedSongCount,
	isIntentEligible,
} from "@/lib/domains/playlists/intent-eligibility";
import type { SongVM } from "@/lib/domains/playlists/types";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";

// ============================================================================
// Input schema
// ============================================================================

const MatchFiltersV1Schema = z
	.object({
		version: z.literal(1),
		languages: z.object({ codes: z.array(z.string()) }).optional(),
		releaseYear: z
			.union([
				z.object({ kind: z.literal("exact"), year: z.number().int() }),
				z.object({ kind: z.literal("before"), end: z.number().int() }),
				z.object({ kind: z.literal("after"), start: z.number().int() }),
				z.object({
					kind: z.literal("range"),
					start: z.number().int(),
					end: z.number().int(),
				}),
			])
			.optional(),
		likedAt: z
			.union([
				z.object({ kind: z.literal("before"), endDate: z.string() }),
				z.object({ kind: z.literal("after"), startDate: z.string() }),
				z.object({
					kind: z.literal("range"),
					startDate: z.string(),
					end: z.union([
						z.object({ kind: z.literal("date"), date: z.string() }),
						z.object({ kind: z.literal("today") }),
					]),
				}),
			])
			.optional(),
		vocalGender: z.enum(["female", "male"]).optional(),
	})
	.strict();

const PreviewPlaylistDraftSchema = z.object({
	/** Natural-language intent phrase (premium feature — may be ignored server-side). */
	intent: z.string().max(5000).optional(),
	/** User-declared genre pills. */
	genrePills: z.array(z.string()).max(10),
	/** Hard match filters applied before scoring. */
	matchFilters: MatchFiltersV1Schema,
	/** Max songs in the preview (5–50, step 5). */
	maxSongs: z.number().int().min(5).max(50),
	/** Song IDs the user explicitly added — always appear first in preview. */
	pinnedSongIds: z.array(z.uuid()).max(50),
	/** Song IDs the user explicitly removed — never appear in results. */
	excludedSongIds: z.array(z.uuid()).max(500),
});

// ============================================================================
// Output type
// ============================================================================

export interface PreviewPlaylistDraftResult {
	preview: SongVM[];
	suggestions: SongVM[];
	totalEligible: number;
	/** True when the intent phrase was applied (account is eligible + intent was provided). */
	intentApplied: boolean;
}

// ============================================================================
// Server function
// ============================================================================

export const previewPlaylistDraft = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => PreviewPlaylistDraftSchema.parse(data))
	.handler(async ({ data, context }): Promise<PreviewPlaylistDraftResult> => {
		const { accountId } = context.session;
		const supabase = createAdminSupabaseClient();

		// Resolve billing state + unlock count in parallel with candidate loading
		const [billingResult, unlockedCount, candidates] = await Promise.all([
			readBillingState(supabase, accountId),
			getUnlockedSongCount(accountId),
			loadPhase1Candidates(accountId),
		]);

		const billingState = Result.isOk(billingResult)
			? billingResult.value
			: // On billing read failure, degrade to free tier (safe)
				{
					plan: "free" as const,
					creditBalance: 0,
					subscriptionStatus: "none" as const,
					cancelAtPeriodEnd: false,
					subscriptionPeriodEnd: null,
					unlimitedAccess: { kind: "none" as const },
					queueBand: "low" as const,
				};

		// Intent eligibility is always computed server-side; client input is ignored
		// when the account is not eligible (defense in depth).
		const eligible = isIntentEligible(billingState, unlockedCount);
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
		);
	});
