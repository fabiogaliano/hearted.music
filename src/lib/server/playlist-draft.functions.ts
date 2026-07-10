/**
 * Server functions for the stateless playlist creation preview engine
 * and the draft→Spotify commit path.
 *
 * previewPlaylistDraft: stateless preview engine (no writes).
 * resolveSpotifyUserId: read the Spotify user ID cached on the account row.
 * persistNewPlaylistConfig: persist match config onto a newly-created playlist
 *   and return the ordered track URIs for the bulk-add step.
 * recordPlaylistMatchDecisions: bulk-write match_decision "added" rows for the
 *   songs committed to the new playlist so they don't resurface as suggestions.
 */

import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { readBillingState } from "@/lib/domains/billing/queries";
import { getSongEmbeddingsBatch } from "@/lib/domains/enrichment/embeddings/queries";
import { EmbeddingService } from "@/lib/domains/enrichment/embeddings/service";
import { selectOwnedSongIds } from "@/lib/domains/library/liked-songs/queries";
import {
	getPlaylistBySpotifyId,
	updatePlaylistMatchConfig,
} from "@/lib/domains/library/playlists/queries";
import { getByIds as getSongsByIds } from "@/lib/domains/library/songs/queries";
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
import { normalizeMatchFilters } from "@/lib/domains/taste/match-filters/normalizers";
import { parseSaveMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import { upsertMatchDecisions } from "@/lib/domains/taste/song-matching/decision-queries";
import { sanitizeGenrePills } from "@/lib/integrations/lastfm/whitelist";
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
	/**
	 * Pages the suggestions window deeper into the ranked candidate pool.
	 * "Refresh suggestions" increments this client-side without changing any
	 * other config, so the same scored ranking yields a genuinely new batch.
	 */
	suggestionsOffset: z.number().int().min(0).max(1000).default(0),
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
			data.suggestionsOffset,
		);
	});

// ============================================================================
// Spotify userId resolution
// ============================================================================

/**
 * Returns the Spotify user ID cached on the account row.
 *
 * `account.spotify_id` is populated during extension sync via applyUserProfile
 * in the extension-sync runner — no extension change is needed. This is a GET
 * because it only reads; the caching write happens at sync time, not here.
 *
 * Returns null when the user has never completed an extension sync with a
 * logged-in Spotify session (new account, extension not connected, etc.).
 */
export const resolveSpotifyUserId = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async ({ context }): Promise<{ spotifyUserId: string | null }> => {
		// account.spotify_id is set during extension sync; expose it here so the
		// client never stores it or passes it back to the server as a parameter.
		const spotifyUserId = context.account.spotify_id ?? null;
		return { spotifyUserId };
	});

// ============================================================================
// Persist match config onto a newly-created playlist
// ============================================================================

const SPOTIFY_PLAYLIST_ID_RE = /^[a-zA-Z0-9]+$/;

const PersistNewPlaylistConfigSchema = z.object({
	/**
	 * Spotify playlist ID (not URI) — extracted from the URI returned by
	 * createPlaylistAcknowledged before calling this function.
	 */
	spotifyId: z.string().min(1).regex(SPOTIFY_PLAYLIST_ID_RE),
	/** Ordered song UUIDs from the previewed draft. */
	songIds: z.array(z.uuid()).max(50),
	/** Natural-language intent phrase (premium). */
	intent: z.string().max(5000).nullable(),
	/** Genre pills from the draft config. */
	genrePills: z.array(z.string()).max(10),
	/** Match filters from the draft config. */
	matchFilters: MatchFiltersV1Schema,
	/** Whether the client reports intent was applied in the preview. */
	intentApplied: z.boolean(),
});

export interface PersistNewPlaylistConfigResult {
	/** Ordered Spotify track URIs for the bulk-add step, in the same order as songIds. */
	trackUris: string[];
	/**
	 * Internal DB playlist id (the `playlist` table's UUID primary key, distinct
	 * from spotifyId). The create-flow result needs this to link into the
	 * managed-playlist detail route (/playlists/$playlistRef), which resolves
	 * against this id, never the Spotify id.
	 */
	playlistId: string;
}

/**
 * Persists the draft config onto a newly-created playlist row and resolves
 * the ordered track URIs so the caller can bulk-add them to Spotify.
 *
 * Responsibilities:
 * - Re-checks intent eligibility server-side (never trusts intentApplied from client).
 * - Writes match_intent / genre_pills / match_filters to the playlist row via
 *   updatePlaylistMatchConfig (the same write path used by the managed-playlist editor).
 * - Returns the ordered Spotify track URIs so the orchestrator can bulk-add them
 *   in one addToPlaylist call (no extra round-trip needed).
 *
 * Ownership check: verifies the playlist belongs to this account before writing
 * (the service-role client bypasses RLS).
 */
export const persistNewPlaylistConfig = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => PersistNewPlaylistConfigSchema.parse(data))
	.handler(
		async ({ data, context }): Promise<PersistNewPlaylistConfigResult> => {
			const { accountId } = context.session;
			const supabase = createAdminSupabaseClient();

			// Verify the playlist belongs to this account (service-role bypasses RLS).
			const playlistResult = await getPlaylistBySpotifyId(
				accountId,
				data.spotifyId,
			);
			if (Result.isError(playlistResult)) {
				throw new Error("Failed to look up playlist");
			}
			if (
				playlistResult.value === null ||
				playlistResult.value.account_id !== accountId
			) {
				throw new Error("Playlist not found");
			}
			const playlistId = playlistResult.value.id;

			// Server-side intent eligibility re-check: billing state + unlock count
			// resolved in parallel with the song lookup and the ownership guard to
			// avoid serial waits. ownedResult constrains data.songIds to the
			// account's active liked_song rows — getSongsByIds hits the global song
			// table via the service-role client, so without this a tampered request
			// could resolve URIs for songs the account never liked.
			const [billingResult, unlockedCount, songsResult, ownedResult] =
				await Promise.all([
					readBillingState(supabase, accountId),
					getUnlockedSongCount(accountId),
					getSongsByIds(data.songIds),
					selectOwnedSongIds(accountId, data.songIds),
				]);

			const billingState = Result.isOk(billingResult)
				? billingResult.value
				: // Degrade to free tier on billing read failure (safe default)
					{
						plan: "free" as const,
						creditBalance: 0,
						subscriptionStatus: "none" as const,
						cancelAtPeriodEnd: false,
						subscriptionPeriodEnd: null,
						unlimitedAccess: { kind: "none" as const },
						queueBand: "low" as const,
					};

			// intent is only persisted when the server independently confirms eligibility
			// AND the client-reported intentApplied flag is true. The client flag gates
			// intent writes only when the feature was actually used in the preview —
			// eligibility alone doesn't mean intent should be saved (e.g. user cleared
			// the field before creating).
			const eligible = isIntentEligible(billingState, unlockedCount);
			const trimmedIntent = data.intent?.trim() ?? "";
			const effectiveIntent =
				eligible && data.intentApplied && trimmedIntent.length > 0
					? trimmedIntent
					: null;

			const genrePills = sanitizeGenrePills(data.genrePills);

			const filtersParseResult = parseSaveMatchFilters(data.matchFilters);
			if (Result.isError(filtersParseResult)) {
				throw new Error(`Invalid match filters: ${filtersParseResult.error}`);
			}
			const matchFilters = normalizeMatchFilters(filtersParseResult.value);

			const updateResult = await updatePlaylistMatchConfig(
				accountId,
				playlistId,
				{
					matchIntent: effectiveIntent,
					genrePills,
					matchFilters,
				},
			);
			if (Result.isError(updateResult)) {
				throw new Error(
					`Failed to persist playlist config: ${updateResult.error.message}`,
				);
			}

			// Build the ordered track URI list from the song rows.
			// Songs not found in the DB (e.g. deleted) are silently dropped — the
			// playlist was created with whatever exists. Preserve the caller's ordering.
			if (Result.isError(songsResult)) {
				// Non-fatal: track URIs can't be resolved. Return empty so the
				// orchestrator skips the add step rather than failing the whole commit.
				console.error(
					"[persistNewPlaylistConfig] song lookup failed:",
					songsResult.error,
				);
				return { trackUris: [], playlistId };
			}

			// Fail closed if ownership can't be verified: without a trusted owned-set
			// we can't safely resolve URIs, so skip the add step rather than trust the
			// caller-supplied id list.
			if (Result.isError(ownedResult)) {
				console.error(
					"[persistNewPlaylistConfig] ownership lookup failed:",
					ownedResult.error,
				);
				return { trackUris: [], playlistId };
			}
			const ownedIds = ownedResult.value;

			const songById = new Map(songsResult.value.map((s) => [s.id, s]));
			const trackUris: string[] = [];
			for (const id of data.songIds) {
				// Skip any id the account doesn't actively like — never resolve URIs
				// for songs outside the caller's own liked library.
				if (!ownedIds.has(id)) continue;
				const song = songById.get(id);
				if (song?.spotify_id) {
					trackUris.push(`spotify:track:${song.spotify_id}`);
				}
			}

			return { trackUris, playlistId };
		},
	);

// ============================================================================
// Bulk match_decision recording
// ============================================================================

const RecordPlaylistMatchDecisionsSchema = z.object({
	/**
	 * Spotify playlist ID — used to look up the internal playlist UUID.
	 */
	spotifyId: z.string().min(1).regex(SPOTIFY_PLAYLIST_ID_RE),
	/** Song UUIDs to record "added" decisions for. */
	songIds: z.array(z.uuid()).max(50),
});

/**
 * Writes match_decision "added" rows for (song, playlist) pairs so those songs
 * don't resurface as suggestions for the new playlist.
 *
 * Uses upsertMatchDecisions (batch path) — no snapshot linkage since the draft
 * was assembled outside the match snapshot system. snapshotId and servedRank are
 * intentionally null: these are implicit positives from the creation flow, not
 * surfaced suggestions the user acted on.
 *
 * Non-fatal from the orchestrator's perspective — a failure here doesn't undo
 * the created playlist or its tracks.
 */
export const recordPlaylistMatchDecisions = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => RecordPlaylistMatchDecisionsSchema.parse(data))
	.handler(async ({ data, context }): Promise<{ recorded: number }> => {
		const { accountId } = context.session;

		if (data.songIds.length === 0) return { recorded: 0 };

		// Look up the internal playlist UUID (match_decision FK references
		// playlist.id) and verify song ownership in parallel. Ownership must be
		// re-checked here: this is a separate entry point from
		// persistNewPlaylistConfig, so it can't rely on that function's guard.
		const [playlistResult, ownedResult] = await Promise.all([
			getPlaylistBySpotifyId(accountId, data.spotifyId),
			selectOwnedSongIds(accountId, data.songIds),
		]);
		if (Result.isError(playlistResult) || playlistResult.value === null) {
			throw new Error("Playlist not found for match decision recording");
		}
		if (Result.isError(ownedResult)) {
			throw new Error(
				"Failed to verify song ownership for match decision recording",
			);
		}
		const playlistId = playlistResult.value.id;

		// Record decisions only for songs the account actually likes — never write
		// match_decision rows for arbitrary catalog UUIDs.
		const ownedSongIds = data.songIds.filter((id) => ownedResult.value.has(id));
		if (ownedSongIds.length === 0) return { recorded: 0 };

		const decisions = ownedSongIds.map((songId) => ({
			accountId,
			songId,
			playlistId,
			decision: "added" as const,
			snapshotId: null,
			servedRank: null,
		}));

		const result = await upsertMatchDecisions(decisions);
		if (Result.isError(result)) {
			throw new Error(
				`Failed to record match decisions: ${result.error.message}`,
			);
		}

		return { recorded: result.value.length };
	});
