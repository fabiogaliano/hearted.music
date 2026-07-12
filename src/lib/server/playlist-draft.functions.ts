/**
 * Thin server-fn adapter for the stateless playlist creation preview engine
 * and the draft→Spotify commit path.
 *
 * Auth, input validation, and DB-client construction live here; the actual
 * multi-domain orchestration (billing + library + taste + enrichment) lives
 * in @/lib/workflows/playlist-studio — see preview.ts and commit.ts.
 *
 * previewPlaylistDraft: stateless preview engine (no writes).
 * resolveSpotifyUserId: read the Spotify user ID cached on the account row.
 * persistNewPlaylistConfig: persist match config onto a newly-created playlist
 *   and return the ordered track URIs for the bulk-add step.
 * recordPlaylistMatchDecisions: bulk-write match_decision "added" rows for the
 *   songs committed to the new playlist so they don't resurface as suggestions.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import type { PersistNewPlaylistConfigResult } from "@/lib/workflows/playlist-studio/commit";
import {
	runPersistNewPlaylistConfig,
	runRecordPlaylistMatchDecisions,
} from "@/lib/workflows/playlist-studio/commit";
import type { PreviewPlaylistDraftResult } from "@/lib/workflows/playlist-studio/preview";
import { runPreviewPlaylistDraft } from "@/lib/workflows/playlist-studio/preview";

// ============================================================================
// Result types (re-exported from the workflow modules that own them)
// ============================================================================

export type { PersistNewPlaylistConfigResult } from "@/lib/workflows/playlist-studio/commit";
export type { PreviewPlaylistDraftResult } from "@/lib/workflows/playlist-studio/preview";

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
// Server function
// ============================================================================

export const previewPlaylistDraft = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => PreviewPlaylistDraftSchema.parse(data))
	.handler(async ({ data, context }): Promise<PreviewPlaylistDraftResult> => {
		const { accountId } = context.session;
		const supabase = createAdminSupabaseClient();
		return runPreviewPlaylistDraft(supabase, accountId, data);
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

export const persistNewPlaylistConfig = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => PersistNewPlaylistConfigSchema.parse(data))
	.handler(
		async ({ data, context }): Promise<PersistNewPlaylistConfigResult> => {
			const { accountId } = context.session;
			const supabase = createAdminSupabaseClient();
			return runPersistNewPlaylistConfig(supabase, accountId, data);
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

export const recordPlaylistMatchDecisions = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => RecordPlaylistMatchDecisionsSchema.parse(data))
	.handler(async ({ data, context }): Promise<{ recorded: number }> => {
		const { accountId } = context.session;
		return runRecordPlaylistMatchDecisions(accountId, data);
	});
