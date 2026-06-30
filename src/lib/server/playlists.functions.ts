import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import {
	getLanguageColumnsForSongs,
	getLikedAtAggregates,
	getReleaseYearAggregates,
} from "@/lib/domains/library/liked-songs/filter-options-queries";
import { getAccountTopGenres as queryAccountTopGenres } from "@/lib/domains/library/liked-songs/queries";
import {
	deletePlaylist,
	getPlaylistById,
	getPlaylistBySpotifyId,
	getPlaylistSongsPage,
	getPlaylists,
	getTargetPlaylists,
	setPlaylistTarget,
	updatePlaylistGenrePills,
	updatePlaylistMatchConfig,
	updatePlaylistMatchIntent,
	updatePlaylistMetadata,
	upsertPlaylists,
} from "@/lib/domains/library/playlists/queries";
import { getByIds as getSongsByIds } from "@/lib/domains/library/songs/queries";
import { utcDateString } from "@/lib/domains/taste/match-filters/dates";
import {
	isLanguageCatalogCode,
	lookupLanguage,
	SUPPORTED_LANGUAGE_CODES,
} from "@/lib/domains/taste/match-filters/languages";
import { normalizeMatchFilters } from "@/lib/domains/taste/match-filters/normalizers";
import { parseSaveMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import { syncActiveQueue } from "@/lib/domains/taste/match-review-queue/service";
import {
	canonicalizeGenre,
	isGenre,
	sanitizeGenrePills,
} from "@/lib/integrations/lastfm/whitelist";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { getEntitledDataEnrichedSongIds } from "@/lib/workflows/enrichment-pipeline/batch";
import { PlaylistManagementChanges } from "@/lib/workflows/library-processing/changes/playlist-management";
import { applyLibraryProcessingChange } from "@/lib/workflows/library-processing/service";
import { captureWithWaitUntil } from "@/utils/posthog-server";

const SPOTIFY_PLAYLIST_URI_RE = /^spotify:playlist:([a-zA-Z0-9]+)$/;

function parsePlaylistSpotifyId(uri: string): string | null {
	const match = uri.match(SPOTIFY_PLAYLIST_URI_RE);
	return match ? match[1] : null;
}

const NoInputSchema = z.undefined();

// ============================================================================
// Playlist management reads
// ============================================================================

export const getPlaylistManagementData = createServerFn({
	method: "GET",
})
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }) => {
		const { session } = context;

		const [allResult, targetResult] = await Promise.all([
			getPlaylists(session.accountId),
			getTargetPlaylists(session.accountId),
		]);

		if (Result.isError(allResult)) {
			// DB read failed — surfaces in Sentry since console is disabled in prod.
			captureServerError(allResult.error, {
				area: "playlists",
				operation: "get_playlist_management_data",
				accountId: session.accountId,
			});
			throw new Error(`Failed to load playlists: ${allResult.error.message}`);
		}

		const targetIds = new Set(
			Result.isOk(targetResult) ? targetResult.value.map((p) => p.id) : [],
		);

		return {
			playlists: allResult.value,
			targetPlaylistIds: [...targetIds],
		};
	});

export interface PlaylistTrack {
	position: number;
	songId: string;
	name: string;
	artists: string[];
	albumName: string | null;
	imageUrl: string | null;
}

export interface PlaylistTracksPageResult {
	tracks: PlaylistTrack[];
	nextCursor: number | null;
}

const PLAYLIST_TRACKS_DEFAULT_LIMIT = 50;
const PLAYLIST_TRACKS_MAX_LIMIT = 100;

const PlaylistTracksPageSchema = z.object({
	playlistId: z.uuid(),
	cursor: z.number().int().min(0).optional(),
	limit: z.number().int().min(1).max(PLAYLIST_TRACKS_MAX_LIMIT).optional(),
});

export const getPlaylistTracksPage = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => PlaylistTracksPageSchema.parse(data))
	.handler(async ({ data, context }): Promise<PlaylistTracksPageResult> => {
		const { session } = context;
		const limit = data.limit ?? PLAYLIST_TRACKS_DEFAULT_LIMIT;

		const playlistResult = await getPlaylistById(
			session.accountId,
			data.playlistId,
		);
		if (Result.isError(playlistResult)) {
			// DB error reading the playlist row — not a normal not-found; capture for Sentry.
			captureServerError(playlistResult.error, {
				area: "playlists",
				operation: "get_playlist_tracks_page",
				accountId: session.accountId,
				extra: { stage: "playlist" },
			});
			console.warn("Failed to load playlist", {
				playlistId: data.playlistId,
				error: playlistResult.error,
			});
			throw new Error("Failed to load playlist");
		}
		if (playlistResult.value === null) {
			throw new Error("Playlist not found");
		}
		// Only authorization gate for this read: service-role bypasses RLS, so
		// without this check any session could fetch any account's tracks.
		if (playlistResult.value.account_id !== session.accountId) {
			console.warn("Playlist access denied: account mismatch", {
				playlistId: data.playlistId,
				ownerAccountId: playlistResult.value.account_id,
				sessionAccountId: session.accountId,
			});
			throw new Error("Playlist not found");
		}

		let cursor = data.cursor;

		while (true) {
			const songsResult = await getPlaylistSongsPage(data.playlistId, {
				cursor,
				limit,
			});
			if (Result.isError(songsResult)) {
				// DB error fetching the songs page — not a normal empty result; capture for Sentry.
				captureServerError(songsResult.error, {
					area: "playlists",
					operation: "get_playlist_tracks_page",
					accountId: session.accountId,
					extra: { stage: "songs" },
				});
				console.warn("Failed to load playlist tracks", {
					playlistId: data.playlistId,
					error: songsResult.error,
				});
				throw new Error("Failed to load playlist tracks");
			}

			const { items: playlistSongs, nextCursor } = songsResult.value;
			if (playlistSongs.length === 0) {
				return { tracks: [], nextCursor: null };
			}

			const songIds = playlistSongs.map((ps) => ps.song_id);
			const songsDataResult = await getSongsByIds(songIds);

			if (Result.isError(songsDataResult)) {
				// DB error loading song rows by id — not a normal not-found; capture for Sentry.
				captureServerError(songsDataResult.error, {
					area: "playlists",
					operation: "get_playlist_tracks_page",
					accountId: session.accountId,
					extra: { stage: "details" },
				});
				console.warn("Failed to load track details", {
					playlistId: data.playlistId,
					error: songsDataResult.error,
				});
				throw new Error("Failed to load track details");
			}

			const songMap = new Map(songsDataResult.value.map((s) => [s.id, s]));
			const tracks = playlistSongs
				.map((ps) => {
					const song = songMap.get(ps.song_id);
					if (!song) return null;
					return {
						position: ps.position,
						songId: song.id,
						name: song.name,
						artists: song.artists ?? [],
						albumName: song.album_name,
						imageUrl: song.image_url,
					};
				})
				.filter((t): t is PlaylistTrack => t !== null);

			if (tracks.length > 0 || nextCursor === null) {
				return { tracks, nextCursor };
			}

			// Skip synthetic empty pages caused by dangling playlist_song rows so the
			// client only sees an empty state when no loadable tracks remain.
			cursor = nextCursor;
		}
	});

// ============================================================================
// Target membership mutations
// ============================================================================

const SetTargetSchema = z.object({
	playlistId: z.uuid(),
	isTarget: z.boolean(),
});

export const setPlaylistTargetMutation = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => SetTargetSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;

		const playlistResult = await getPlaylistById(
			session.accountId,
			data.playlistId,
		);
		if (Result.isError(playlistResult)) {
			// DB error reading playlist for ownership check — not a normal not-found; capture for Sentry.
			captureServerError(playlistResult.error, {
				area: "playlists",
				operation: "set_playlist_target",
				accountId: session.accountId,
				extra: { stage: "ownership_check" },
			});
			throw new Error("Playlist not found");
		}
		if (
			!playlistResult.value ||
			playlistResult.value.account_id !== session.accountId
		) {
			throw new Error("Playlist not found");
		}

		const result = await setPlaylistTarget(
			session.accountId,
			data.playlistId,
			data.isTarget,
		);

		if (Result.isError(result)) {
			// DB write failed — surfaces in Sentry since console is disabled in prod.
			captureServerError(result.error, {
				area: "playlists",
				operation: "set_playlist_target",
				accountId: session.accountId,
			});
			throw new Error(`Failed to set playlist target: ${result.error.message}`);
		}

		return { success: true, playlist: result.value };
	});

// ============================================================================
// Create acknowledgement
// ============================================================================

// name/description are written verbatim to playlist (TEXT, unconstrained, ~1GB
// max), so bound them at the boundary. Spotify caps names ~100 / descriptions
// ~300; 500/5000 give legit acknowledgements headroom while stopping an authed
// client from bloating its own rows (and the public profile that renders them).
const AcknowledgeCreateSchema = z.object({
	uri: z.string().regex(SPOTIFY_PLAYLIST_URI_RE),
	name: z.string().min(1).max(500),
});

export const acknowledgePlaylistCreate = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AcknowledgeCreateSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;
		const spotifyId = parsePlaylistSpotifyId(data.uri);
		if (!spotifyId) throw new Error(`Invalid Spotify URI: ${data.uri}`);

		const result = await upsertPlaylists(session.accountId, [
			{
				spotify_id: spotifyId,
				name: data.name,
				description: null,
				snapshot_id: null,
				is_public: true,
				song_count: 0,
				is_target: false,
				image_url: null,
			},
		]);

		if (Result.isError(result)) {
			// DB upsert failed for extension-initiated create — surfaces in Sentry since console is disabled in prod.
			captureServerError(result.error, {
				area: "playlists",
				operation: "acknowledge_playlist_create",
				accountId: session.accountId,
			});
			throw new Error(
				`Failed to acknowledge playlist create: ${result.error.message}`,
			);
		}

		return { success: true, spotifyId };
	});

// ============================================================================
// Metadata update acknowledgement
// ============================================================================

const AcknowledgeUpdateSchema = z.object({
	spotifyId: z.string().min(1),
	name: z.string().min(1).max(500).optional(),
	description: z.string().max(5000).nullable().optional(),
	songCount: z.number().int().nonnegative().optional(),
	imageUrl: z.string().nullable().optional(),
});

export const acknowledgePlaylistUpdate = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AcknowledgeUpdateSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;
		const metadata: {
			name?: string;
			description?: string | null;
			song_count?: number;
			image_url?: string | null;
		} = {};
		if (data.name !== undefined) metadata.name = data.name;
		if (data.description !== undefined) metadata.description = data.description;
		if (data.songCount !== undefined) metadata.song_count = data.songCount;
		if (data.imageUrl !== undefined) metadata.image_url = data.imageUrl;

		const result = await updatePlaylistMetadata(
			session.accountId,
			data.spotifyId,
			metadata,
		);

		if (Result.isError(result)) {
			// DB write failed for extension-initiated update — surfaces in Sentry since console is disabled in prod.
			captureServerError(result.error, {
				area: "playlists",
				operation: "acknowledge_playlist_update",
				accountId: session.accountId,
			});
			throw new Error(
				`Failed to acknowledge playlist update: ${result.error.message}`,
			);
		}

		return { success: true };
	});

// ============================================================================
// Delete acknowledgement
// ============================================================================

const AcknowledgeDeleteSchema = z.object({
	uri: z.string().regex(SPOTIFY_PLAYLIST_URI_RE),
});

export const acknowledgePlaylistDelete = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AcknowledgeDeleteSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;
		const spotifyId = parsePlaylistSpotifyId(data.uri);
		if (!spotifyId) throw new Error(`Invalid Spotify URI: ${data.uri}`);

		const existing = await getPlaylistBySpotifyId(session.accountId, spotifyId);
		if (Result.isError(existing)) {
			// DB error during look-up for extension-initiated delete — surfaces in Sentry since console is disabled in prod.
			captureServerError(existing.error, {
				area: "playlists",
				operation: "acknowledge_playlist_delete",
				accountId: session.accountId,
				extra: { stage: "lookup" },
			});
			throw new Error(
				`Failed to look up playlist for delete: ${existing.error.message}`,
			);
		}

		// Idempotent: if already absent, treat as success
		if (existing.value === null) {
			return { success: true, alreadyAbsent: true };
		}

		const deleteResult = await deletePlaylist(
			session.accountId,
			existing.value.id,
		);
		if (Result.isError(deleteResult)) {
			// DB delete failed for extension-initiated delete — surfaces in Sentry since console is disabled in prod.
			captureServerError(deleteResult.error, {
				area: "playlists",
				operation: "acknowledge_playlist_delete",
				accountId: session.accountId,
				extra: { stage: "delete" },
			});
			throw new Error(
				`Failed to acknowledge playlist delete: ${deleteResult.error.message}`,
			);
		}

		return { success: true, alreadyAbsent: false };
	});

// ============================================================================
// Genre pills save
// ============================================================================

const SaveGenrePillsSchema = z.object({
	playlistId: z.uuid(),
	genres: z.array(z.string()),
});

export const savePlaylistGenrePills = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => SaveGenrePillsSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;

		// Explicit pre-check mirrors setPlaylistTargetMutation: the service-role
		// client bypasses RLS, so we must verify ownership before writing.
		const playlistResult = await getPlaylistById(
			session.accountId,
			data.playlistId,
		);
		if (Result.isError(playlistResult)) {
			// DB error reading playlist for ownership check — not a normal not-found; capture for Sentry.
			captureServerError(playlistResult.error, {
				area: "playlists",
				operation: "save_playlist_genre_pills",
				accountId: session.accountId,
				extra: { stage: "ownership_check" },
			});
			throw new Error("Playlist not found");
		}
		if (
			!playlistResult.value ||
			playlistResult.value.account_id !== session.accountId
		) {
			throw new Error("Playlist not found");
		}

		const pills = sanitizeGenrePills(data.genres);

		const updateResult = await updatePlaylistGenrePills(
			session.accountId,
			data.playlistId,
			pills,
		);
		if (Result.isError(updateResult)) {
			// DB write failed — surfaces in Sentry since console is disabled in prod.
			captureServerError(updateResult.error, {
				area: "playlists",
				operation: "save_playlist_genre_pills",
				accountId: session.accountId,
			});
			throw new Error(
				`Failed to save genre pills: ${updateResult.error.message}`,
			);
		}

		// Pills change the profile hash (genre_pills is an explicit hash input in
		// 1.4) and alter the genre distribution + fusion weights, so the next match
		// snapshot must recompute. Genre pills are a scoring signal, not a read-time
		// filter, so we emit scoringConfigChanged — not readTimeFilterChanged.
		const applyResult = await applyLibraryProcessingChange(
			PlaylistManagementChanges.sessionFlushed({
				accountId: session.accountId,
				targetMembershipChanged: false,
				scoringConfigChanged: true,
				readTimeFilterChanged: false,
			}),
		);
		if (Result.isError(applyResult)) {
			// Non-fatal: pills are written; invalidation failure is logged but does
			// not roll back the save. The snapshot will recompute on the next
			// organic trigger (library sync, enrichment, etc.).
			captureServerError(applyResult.error, {
				area: "playlists",
				operation: "save_playlist_genre_pills",
				accountId: session.accountId,
				extra: { stage: "post_save_invalidation" },
			});
			console.error(
				"[playlists] genre pills saved but snapshot invalidation failed:",
				applyResult.error,
			);
		}

		return { success: true, pills };
	});

// ============================================================================
// Match intent save
// ============================================================================

// match_intent is written verbatim to the playlist row (TEXT, capped at 5000 by
// a DB CHECK). Bound the raw input here so an authed client can't push past the
// constraint into a DB error; the handler then trims and collapses empty → null.
const SaveMatchIntentSchema = z.object({
	playlistId: z.uuid(),
	matchIntent: z.string().max(5000).nullable(),
});

export const savePlaylistMatchIntent = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => SaveMatchIntentSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;

		// Explicit pre-check mirrors savePlaylistGenrePills: the service-role
		// client bypasses RLS, so we must verify ownership before writing.
		const playlistResult = await getPlaylistById(
			session.accountId,
			data.playlistId,
		);
		if (Result.isError(playlistResult)) {
			// DB error reading playlist for ownership check — not a normal not-found; capture for Sentry.
			captureServerError(playlistResult.error, {
				area: "playlists",
				operation: "save_playlist_match_intent",
				accountId: session.accountId,
				extra: { stage: "ownership_check" },
			});
			throw new Error("Playlist not found");
		}
		if (
			!playlistResult.value ||
			playlistResult.value.account_id !== session.accountId
		) {
			throw new Error("Playlist not found");
		}

		const trimmed = data.matchIntent?.trim() ?? "";
		const matchIntent = trimmed.length > 0 ? trimmed : null;

		const updateResult = await updatePlaylistMatchIntent(
			session.accountId,
			data.playlistId,
			matchIntent,
		);
		if (Result.isError(updateResult)) {
			// DB write failed — surfaces in Sentry since console is disabled in prod.
			captureServerError(updateResult.error, {
				area: "playlists",
				operation: "save_playlist_match_intent",
				accountId: session.accountId,
			});
			throw new Error(
				`Failed to save match intent: ${updateResult.error.message}`,
			);
		}

		// match_intent feeds the playlist profile (intent text → embedding,
		// computeIntentWeight), so the next match snapshot must recompute. Intent
		// text is a scoring signal — not a read-time filter — so we emit
		// scoringConfigChanged to ensure the reconciler advances matchSnapshotRefresh.
		const applyResult = await applyLibraryProcessingChange(
			PlaylistManagementChanges.sessionFlushed({
				accountId: session.accountId,
				targetMembershipChanged: false,
				scoringConfigChanged: true,
				readTimeFilterChanged: false,
			}),
		);
		if (Result.isError(applyResult)) {
			// Non-fatal: the intent is written; invalidation failure is logged but
			// does not roll back the save. The snapshot will recompute on the next
			// organic trigger (library sync, enrichment, etc.).
			captureServerError(applyResult.error, {
				area: "playlists",
				operation: "save_playlist_match_intent",
				accountId: session.accountId,
				extra: { stage: "post_save_invalidation" },
			});
			console.error(
				"[playlists] match intent saved but snapshot invalidation failed:",
				applyResult.error,
			);
		}

		// Funnel step 1 (intent → snapshot → review). intent text is private, so
		// only its presence and length travel, never the content.
		await captureWithWaitUntil({
			distinctId: session.accountId,
			event: "match_intent_set",
			properties: {
				playlist_id: data.playlistId,
				has_intent: matchIntent !== null,
				intent_length: matchIntent?.length ?? 0,
			},
		});

		return { success: true, matchIntent };
	});

export type SavePlaylistMatchConfigInput = {
	playlistId: string;
	matchIntent: string | null;
	genrePills: string[];
	matchFilters: PlaylistMatchFiltersV1;
};

export type SavePlaylistMatchConfigResult = {
	matchIntent: string | null;
	genrePills: string[];
	matchFilters: PlaylistMatchFiltersV1;
};

// match_intent is TEXT with a 5000-char DB CHECK; matchFilters is jsonb.
// Bound the raw string fields at the boundary to avoid hitting DB constraints.
const SaveMatchConfigSchema = z.object({
	playlistId: z.uuid(),
	matchIntent: z.string().max(5000).nullable(),
	genrePills: z.array(z.string()),
	matchFilters: z.unknown(),
});

export const savePlaylistMatchConfig = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => SaveMatchConfigSchema.parse(data))
	.handler(
		async ({ data, context }): Promise<SavePlaylistMatchConfigResult> => {
			const { session } = context;

			// Service-role client bypasses RLS, so we must verify ownership before writing.
			const playlistResult = await getPlaylistById(
				session.accountId,
				data.playlistId,
			);
			if (Result.isError(playlistResult)) {
				// DB error reading playlist for ownership check — not a normal not-found; capture for Sentry.
				captureServerError(playlistResult.error, {
					area: "playlists",
					operation: "save_playlist_match_config",
					accountId: session.accountId,
					extra: { stage: "ownership_check" },
				});
				console.warn("Failed to load playlist", {
					playlistId: data.playlistId,
					error: playlistResult.error,
				});
				throw new Error("Failed to load playlist");
			}
			if (playlistResult.value === null) {
				throw new Error("Playlist not found");
			}
			if (playlistResult.value.account_id !== session.accountId) {
				console.warn("Playlist access denied: account mismatch", {
					playlistId: data.playlistId,
					ownerAccountId: playlistResult.value.account_id,
					sessionAccountId: session.accountId,
				});
				throw new Error("Playlist not found");
			}

			// Trim only leading/trailing whitespace; internal whitespace/newlines
			// are intentional user input and must be preserved exactly.
			const trimmed = data.matchIntent?.trim() ?? "";
			const matchIntent = trimmed.length > 0 ? trimmed : null;

			const genrePills = sanitizeGenrePills(data.genrePills);

			const filtersParseResult = parseSaveMatchFilters(data.matchFilters);
			if (Result.isError(filtersParseResult)) {
				throw new Error(`Invalid match filters: ${filtersParseResult.error}`);
			}
			// Validation accepts e.g. duplicate language codes; normalize to the
			// canonical form before persisting and returning so storage never holds
			// (and clients never round-trip) a denormalized object.
			const matchFilters = normalizeMatchFilters(filtersParseResult.value);

			const updateResult = await updatePlaylistMatchConfig(
				session.accountId,
				data.playlistId,
				{ matchIntent, genrePills, matchFilters },
			);
			if (Result.isError(updateResult)) {
				// DB atomic write failed — surfaces in Sentry since console is disabled in prod.
				captureServerError(updateResult.error, {
					area: "playlists",
					operation: "save_playlist_match_config",
					accountId: session.accountId,
				});
				throw new Error(
					`Failed to save match config: ${updateResult.error.message}`,
				);
			}

			// Determine what actually changed so we can route to the correct
			// invalidation path. Scoring signals (intent, genre pills) require a full
			// snapshot recompute; read-time filter predicates (match_filters) only
			// need active sessions to be re-synced against the existing snapshot.
			const existingPlaylist = playlistResult.value;
			const scoringConfigChanged =
				matchIntent !== (existingPlaylist.match_intent ?? null) ||
				JSON.stringify(genrePills) !==
					JSON.stringify(existingPlaylist.genre_pills ?? []);
			const readTimeFilterChanged =
				JSON.stringify(matchFilters) !==
				JSON.stringify(existingPlaylist.match_filters);

			if (scoringConfigChanged) {
				// Scoring or mixed change — full snapshot recompute path.
				const applyResult = await applyLibraryProcessingChange(
					PlaylistManagementChanges.sessionFlushed({
						accountId: session.accountId,
						targetMembershipChanged: false,
						scoringConfigChanged: true,
						readTimeFilterChanged,
					}),
				);
				if (Result.isError(applyResult)) {
					// Non-fatal: fields are written; invalidation failure is logged but
					// does not roll back or mask the save. The snapshot will recompute
					// on the next organic trigger.
					captureServerError(applyResult.error, {
						area: "playlists",
						operation: "save_playlist_match_config",
						accountId: session.accountId,
						extra: { stage: "post_save_invalidation" },
					});
					console.error(
						"[playlists] match config saved but snapshot invalidation failed:",
						applyResult.error,
					);
				}
			} else if (readTimeFilterChanged) {
				// Filter-only change — sync all active sessions without a full recompute.
				// Both orientations: filter predicates apply to song-mode and playlist-mode
				// queues alike; a changed visibility hash allows newly visible subjects to
				// be appended from the already-applied snapshot (MSR-37).
				for (const orientation of ["song", "playlist"] as const) {
					const syncResult = await syncActiveQueue(
						session.accountId,
						orientation,
					);
					if (Result.isError(syncResult)) {
						// Non-fatal: filters are written; sync failure is logged but does
						// not roll back the save. Sessions will re-sync on the next read.
						captureServerError(syncResult.error, {
							area: "playlists",
							operation: "save_playlist_match_config",
							accountId: session.accountId,
							extra: { stage: "post_save_invalidation" },
						});
						console.error(
							"[playlists] match filters saved but session sync failed:",
							syncResult.error,
						);
					}
				}
			}
			// If neither changed (idempotent save) no invalidation is needed.

			return { matchIntent, genrePills, matchFilters };
		},
	);

// ============================================================================
// Genre pills quick-picks
// ============================================================================

const TOP_GENRES_LIMIT = 12;

// Broad, universally-recognizable genres shown while the library is still
// syncing (or a lookup fails) so the picker always has actionable suggestions.
// Every entry is a canonical whitelist form.
const STATIC_TOP_GENRES: readonly string[] = [
	"rock",
	"pop",
	"hip-hop",
	"electronic",
	"rnb",
	"jazz",
	"indie",
	"folk",
	"metal",
	"classical",
];

/**
 * Top genres across the account's liked songs, canonicalized + deduped, for the
 * genre-pills picker quick-picks. Over-fetches raw tags then collapses variant
 * spellings (e.g. "hip hop" + "hip-hop" → "hip-hop") so the canonical count is
 * what the cap targets. Falls back to a static broad-genre seed when the library
 * is empty/syncing or the lookup fails — the picker is never left without picks.
 */
export const getAccountTopGenres = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<{ genres: string[] }> => {
		const { session } = context;

		const result = await queryAccountTopGenres(
			session.accountId,
			TOP_GENRES_LIMIT * 2,
		);
		if (Result.isError(result)) {
			console.error("[playlists] top genres lookup failed:", result.error);
			return { genres: [...STATIC_TOP_GENRES] };
		}

		const canonical: string[] = [];
		const seen = new Set<string>();
		for (const { genre } of result.value) {
			const form = canonicalizeGenre(genre);
			if (!isGenre(form) || seen.has(form)) continue;
			seen.add(form);
			canonical.push(form);
			if (canonical.length === TOP_GENRES_LIMIT) break;
		}

		return {
			genres: canonical.length > 0 ? canonical : [...STATIC_TOP_GENRES],
		};
	});

// ============================================================================
// Playlist management session flush
// ============================================================================

const FlushSessionSchema = z.object({
	targetMembershipChanged: z.boolean(),
	scoringConfigChanged: z.boolean(),
	readTimeFilterChanged: z.boolean(),
});

export const flushPlaylistManagementSession = createServerFn({
	method: "POST",
})
	.middleware([authMiddleware])
	.inputValidator((data) => FlushSessionSchema.parse(data))
	.handler(async ({ data, context }) => {
		const { session } = context;

		const nothingChanged =
			!data.targetMembershipChanged &&
			!data.scoringConfigChanged &&
			!data.readTimeFilterChanged;
		if (nothingChanged) {
			return { flushed: false };
		}

		const needsRefresh =
			data.targetMembershipChanged || data.scoringConfigChanged;

		if (needsRefresh) {
			// Membership or scoring change — full snapshot recompute path.
			const applyResult = await applyLibraryProcessingChange(
				PlaylistManagementChanges.sessionFlushed({
					accountId: session.accountId,
					targetMembershipChanged: data.targetMembershipChanged,
					scoringConfigChanged: data.scoringConfigChanged,
					readTimeFilterChanged: data.readTimeFilterChanged,
				}),
			);
			if (Result.isError(applyResult)) {
				console.error(
					"[playlists] library-processing apply failed:",
					applyResult.error,
				);
			}
		} else {
			// Filter-only flush — sync all active sessions without enqueueing a refresh.
			// Both orientations share the same filter predicates; syncing both ensures
			// newly visible subjects are appended to whichever session is active (MSR-37).
			for (const orientation of ["song", "playlist"] as const) {
				const syncResult = await syncActiveQueue(
					session.accountId,
					orientation,
				);
				if (Result.isError(syncResult)) {
					console.error(
						"[playlists] filter-only flush session sync failed:",
						syncResult.error,
					);
				}
			}
		}

		return { flushed: true };
	});

// ============================================================================
// Filter options read
// ============================================================================

/**
 * Returns compact filter option data for the current account's matching-eligible
 * library. The population is identical to getEntitledDataEnrichedSongIds so
 * displayed counts and bounds are always aligned with actual suggestions.
 *
 * Decision — catalog payload: we include both "detected" (found in the library)
 * and "catalog" (not detected but selectable) entries. The client needs the full
 * catalog for the language picker regardless; returning it here in one payload
 * means CMHF-14 never needs a second round-trip to hydrate catalog-only entries.
 * Detected entries come first sorted by count desc, then catalog-only entries
 * sorted alphabetically — mirroring the picker's ordering contract.
 *
 * Decision — uncataloged detected codes: excluded from the returned payload but
 * logged so the catalog can be expanded. The client can only select catalog codes,
 * so silently dropping them from the response is the safe path.
 */
export const getPlaylistMatchFilterOptions = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<PlaylistMatchFilterOptions> => {
		const { session } = context;
		const accountId = session.accountId;

		// One RPC call for the matching-eligible song ids, then three compact
		// aggregation queries in parallel. No full song rows are loaded.
		let eligibleSongIds: string[];
		try {
			eligibleSongIds = await getEntitledDataEnrichedSongIds(accountId);
		} catch (err) {
			// Eligibility RPC threw — surfaces in Sentry since console is disabled in prod.
			captureServerError(err, {
				area: "playlists",
				operation: "get_playlist_match_filter_options",
				accountId,
				extra: { stage: "eligibility" },
			});
			console.error("[filter-options] eligibility fetch failed:", err);
			throw new Error("Failed to load filter options");
		}

		const [languageResult, releaseYearResult, likedAtResult] =
			await Promise.all([
				getLanguageColumnsForSongs(eligibleSongIds),
				getReleaseYearAggregates(eligibleSongIds),
				getLikedAtAggregates(accountId, eligibleSongIds),
			]);

		if (Result.isError(languageResult)) {
			// DB aggregation failed — surfaces in Sentry since console is disabled in prod.
			captureServerError(languageResult.error, {
				area: "playlists",
				operation: "get_playlist_match_filter_options",
				accountId,
				extra: { stage: "language" },
			});
			console.error(
				"[filter-options] language aggregation failed:",
				languageResult.error,
			);
			throw new Error("Failed to load filter options");
		}
		if (Result.isError(releaseYearResult)) {
			// DB aggregation failed — surfaces in Sentry since console is disabled in prod.
			captureServerError(releaseYearResult.error, {
				area: "playlists",
				operation: "get_playlist_match_filter_options",
				accountId,
				extra: { stage: "releaseYear" },
			});
			console.error(
				"[filter-options] release-year aggregation failed:",
				releaseYearResult.error,
			);
			throw new Error("Failed to load filter options");
		}
		if (Result.isError(likedAtResult)) {
			// DB aggregation failed — surfaces in Sentry since console is disabled in prod.
			captureServerError(likedAtResult.error, {
				area: "playlists",
				operation: "get_playlist_match_filter_options",
				accountId,
				extra: { stage: "likedAt" },
			});
			console.error(
				"[filter-options] liked-at aggregation failed:",
				likedAtResult.error,
			);
			throw new Error("Failed to load filter options");
		}

		// Build language counts — primary + secondary, once per code per song.
		const detectedCounts = new Map<string, number>();
		for (const row of languageResult.value) {
			const codesForSong = new Set<string>();

			if (row.language) codesForSong.add(row.language);
			if (row.language_secondary) codesForSong.add(row.language_secondary);

			for (const code of codesForSong) {
				if (!isLanguageCatalogCode(code)) {
					// Skip here; logging is de-duped in the second pass (uncatalogedCodes
					// set) to avoid one warn per song on large libraries.
					continue;
				}
				detectedCounts.set(code, (detectedCounts.get(code) ?? 0) + 1);
			}
		}

		// Log uncataloged codes once each so the catalog maintainer can expand it.
		const uncatalogedCodes = new Set<string>();
		for (const row of languageResult.value) {
			for (const code of [row.language, row.language_secondary]) {
				if (
					code &&
					!isLanguageCatalogCode(code) &&
					!uncatalogedCodes.has(code)
				) {
					uncatalogedCodes.add(code);
					console.warn(
						"[filter-options] detected language code not in catalog — excluded from options:",
						code,
					);
				}
			}
		}

		// Detected entries sorted by count desc, then catalog-only alphabetically.
		const detected: PlaylistMatchFilterOptions["languages"] = [
			...detectedCounts,
		]
			.sort(([, a], [, b]) => b - a)
			.map(([code, count]) => {
				const entry = lookupLanguage(code);
				return {
					code,
					label: entry?.label ?? code,
					count,
					source: "detected" as const,
				};
			});

		const detectedCodeSet = new Set(detectedCounts.keys());
		const catalogOnly: PlaylistMatchFilterOptions["languages"] = [
			...SUPPORTED_LANGUAGE_CODES,
		]
			.filter((code) => !detectedCodeSet.has(code))
			.map((code) => {
				const entry = lookupLanguage(code);
				return {
					code,
					label: entry?.label ?? code,
					count: 0,
					source: "catalog" as const,
				};
			})
			.sort((a, b) => a.label.localeCompare(b.label));

		const today = utcDateString(Date.now());

		return {
			languages: [...detected, ...catalogOnly],
			releaseYears: {
				min: releaseYearResult.value.min,
				max: releaseYearResult.value.max,
				counts: releaseYearResult.value.counts,
			},
			likedAt: {
				oldest: likedAtResult.value.oldest,
				today,
				yearCounts: likedAtResult.value.yearCounts,
			},
		};
	});
