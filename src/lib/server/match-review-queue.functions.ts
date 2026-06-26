import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { captureVisiblePairsAtomic } from "@/lib/domains/taste/match-review-queue/capture-visible-pairs";
import {
	addQueueItemDecisionAtomically,
	clearSongNewness,
	dismissQueueItemAtomically,
	fetchActiveSession,
	fetchQueueItems,
	finishQueueItemAtomically,
	mapItemToDto,
} from "@/lib/domains/taste/match-review-queue/queries";
import {
	createOrResumeQueue,
	getQueueSummary,
	markItemPresented,
	syncActiveQueue,
} from "@/lib/domains/taste/match-review-queue/service";
import type {
	MatchOrientation,
	MatchReviewQueueItem,
	MatchReviewQueueItemDto,
} from "@/lib/domains/taste/match-review-queue/types";
import { computeVisibleSuggestionList } from "@/lib/domains/taste/match-review-queue/visible-suggestion-list";

/** Validates orientation inputs at every queue boundary (D12, every queue boundary takes orientation explicitly). */
export const MatchOrientationSchema = z.enum(["song", "playlist"] as const);

import { getPreferredMatchViewMode } from "@/lib/domains/library/accounts/preferences-queries";
import { getMatchDecisionsForSongs } from "@/lib/domains/taste/song-matching/decision-queries";
import {
	getLatestMatchSnapshot,
	getMatchResultDetailsForSong,
	getServedRanksForSong,
} from "@/lib/domains/taste/song-matching/queries";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { getOrderedUndecidedSongIds } from "@/lib/server/matching.functions";
import type { MatchingPlaylistMatch, MatchingSong } from "./matching.functions";

const NoInputSchema = z.undefined();

// Typed item read result — co-located because it is owned by this file's read
// path and nothing outside Phase 3 currently consumes it.
export type MatchReviewItemRead =
	| {
			status: "ready";
			itemId: string;
			/** Orientation of the card shown to the user (E10). */
			mode: "song" | "playlist";
			reviewItem: MatchingSong;
			suggestions: MatchingPlaylistMatch[];
	  }
	| {
			status: "unavailable";
			itemId: string;
			reason:
				| "not-entitled"
				| "missing-song"
				| "snapshot-not-owned"
				| "no-visible-suggestions"
				| "already-resolved";
			message: string;
	  }
	| {
			status: "retryable-error";
			itemId: string;
			message: string;
	  };

export interface MatchReviewStartResult {
	sessionId: string;
	/** Ordered queue item ids for the route loader to bootstrap the card stack. */
	itemIds: string[];
	total: number;
	caughtUp: boolean;
}

export interface MatchReviewResult {
	sessionId: string;
	items: Array<{
		id: string;
		position: number;
		state: string;
		songId: string;
		sourceSnapshotId: string;
	}>;
	total: number;
	/** True when every item is resolved — derived from queue state, not null song. */
	caughtUp: boolean;
	/**
	 * Entitled, undecided songs whose only matches sit below the user's strictness
	 * bar. Only computed on the caught-up path (where the empty state needs it to
	 * choose between the "loosen strictness" nudge and "nothing surfaced"); 0
	 * otherwise. Lets the empty state distinguish "hidden by strictness" from
	 * "genuinely nothing".
	 */
	hiddenSongCount: number;
}

export interface MatchReviewItemPresentedResult {
	success: boolean;
	itemId: string;
	state: string;
}

/**
 * Loads the queue item only when it exists AND belongs to the account.
 * Returns null for a missing or foreign item — callers must not leak any data
 * about items they don't own.
 *
 * Uses mapItemToDto so the returned DTO carries a MatchReviewSubject
 * discriminated union instead of the legacy nullable song_id field. Invalid
 * subject rows (wrong orientation vs column) throw rather than returning null,
 * so ownership-verified callers always get a typed shape or a hard error.
 */
async function fetchOwnedQueueItem(
	itemId: string,
	accountId: string,
): Promise<MatchReviewQueueItemDto | null> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("match_review_queue_item")
		.select("*")
		.eq("id", itemId)
		.eq("account_id", accountId)
		.maybeSingle();

	if (error || !data) return null;

	return mapItemToDto(data);
}

/** Derived from unresolved item count — never from null song data. */
function deriveCaughtUp(items: MatchReviewQueueItem[]): boolean {
	return items.every((item) => item.state === "resolved");
}

const StartMatchReviewSchema = z.object({
	orientation: MatchOrientationSchema,
});

/**
 * Creates or resumes the active queue for the authed account and returns the
 * session id + ordered item ids the route loader needs to bootstrap the card
 * stack. Thin wrapper: all queue logic lives in the domain service.
 */
export const startOrResumeMatchReview = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => StartMatchReviewSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewStartResult> => {
		const { session } = context;
		const { orientation } = data;

		const queueResult = await createOrResumeQueue(
			session.accountId,
			orientation,
		);
		if (Result.isError(queueResult)) {
			throw new Error(
				"Could not prepare your match review queue. Please try again.",
			);
		}

		const activeSession =
			queueResult.value.kind === "no_snapshot"
				? null
				: queueResult.value.session;

		if (!activeSession) {
			return { sessionId: "", itemIds: [], total: 0, caughtUp: true };
		}

		const itemsResult = await fetchQueueItems(activeSession.id);
		if (Result.isError(itemsResult)) {
			throw new Error(
				"Could not load your match review queue. Please try again.",
			);
		}

		const items = itemsResult.value;
		const caughtUp = deriveCaughtUp(items);
		const itemIds = items.map((i) => i.id);

		return {
			sessionId: activeSession.id,
			itemIds,
			total: items.length,
			caughtUp,
		};
	});

const GetMatchReviewSchema = z.object({
	orientation: MatchOrientationSchema,
});

/**
 * Returns the active session + ordered queue items with enough metadata for
 * the card stack. Caught-up state is derived from item states — never from
 * null song data.
 */
export const getMatchReview = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetMatchReviewSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewResult | null> => {
		const { session } = context;
		const { orientation } = data;

		const sessionResult = await fetchActiveSession(
			session.accountId,
			orientation,
		);
		if (Result.isError(sessionResult)) {
			throw new Error(
				"Could not load your match review queue. Please try again.",
			);
		}

		if (!sessionResult.value) {
			// No active queue: caller should run startOrResumeMatchReview first.
			return {
				sessionId: "",
				items: [],
				total: 0,
				caughtUp: true,
				hiddenSongCount: 0,
			};
		}

		const activeSession = sessionResult.value;
		const itemsResult = await fetchQueueItems(activeSession.id);
		if (Result.isError(itemsResult)) {
			throw new Error(
				"Could not load your match review queue. Please try again.",
			);
		}

		const items = itemsResult.value;
		const caughtUp = deriveCaughtUp(items);

		// Only the caught-up empty state needs the hidden-by-strictness count, so
		// computing it here keeps the active-review hot path free of the extra
		// snapshot read. getOrderedUndecidedSongIds owns the strictness diff.
		let hiddenSongCount = 0;
		if (caughtUp) {
			const snapshotResult = await getLatestMatchSnapshot(session.accountId);
			if (Result.isOk(snapshotResult) && snapshotResult.value) {
				const ordered = await getOrderedUndecidedSongIds(
					snapshotResult.value.id,
					session.accountId,
				);
				hiddenSongCount = ordered.hiddenSongCount;
			}
		}

		return {
			sessionId: activeSession.id,
			items: items.map((item) => ({
				id: item.id,
				position: item.position,
				state: item.state,
				songId: item.songId,
				sourceSnapshotId: item.sourceSnapshotId,
			})),
			total: items.length,
			caughtUp,
			hiddenSongCount,
		};
	});

const GetMatchReviewItemSchema = z.object({
	itemId: z.uuid(),
});

/**
 * Core read path for a single queue card.
 *
 * Security: song_id and source_snapshot_id are read from the OWNED queue item
 * row — never from client input. A foreign or missing item returns 'error'
 * without leaking any data about what exists.
 *
 * Strictness: the SESSION's stored strictness_min_score is used, not a live
 * re-read, so the bar cannot shift on cards the user is already reviewing.
 */
export const getMatchReviewItem = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetMatchReviewItemSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewItemRead> => {
		const { session } = context;
		const { itemId } = data;

		try {
			// Ownership check: load item by id AND account_id in one query. If it
			// doesn't exist or belongs to another account we return an error shape
			// without any indication of whether the item id exists at all.
			const item = await fetchOwnedQueueItem(itemId, session.accountId);
			if (!item) {
				return {
					status: "retryable-error",
					itemId,
					message: "Item not found.",
				};
			}

			// Narrow to song orientation — this server function is song-mode-only.
			// Playlist-mode items return 'missing-song' so the card falls into the
			// unavailable state without leaking orientation details to the UI.
			if (item.subject.orientation !== "song") {
				return {
					status: "unavailable",
					itemId,
					reason: "missing-song",
					message: "This item is not a song review card.",
				};
			}
			const songId = item.subject.songId;

			// Load the session to get the stored strictness score.
			const supabase = createAdminSupabaseClient();
			const { data: sessionRow, error: sessionError } = await supabase
				.from("match_review_session")
				.select("strictness_min_score")
				.eq("id", item.sessionId)
				.eq("account_id", session.accountId)
				.maybeSingle();

			if (sessionError || !sessionRow) {
				return {
					status: "unavailable",
					itemId,
					reason: "snapshot-not-owned",
					message: "This item's session could not be verified.",
				};
			}

			const strictnessMinScore = sessionRow.strictness_min_score;

			// Entitlement check at read time — the song may have been revoked since
			// the queue was built.
			const entitledCheck = await supabase.rpc("is_account_song_entitled", {
				p_account_id: session.accountId,
				p_song_id: songId,
			});
			if (entitledCheck.error || !entitledCheck.data) {
				return {
					status: "unavailable",
					itemId,
					reason: "not-entitled",
					message: "This song is no longer available to match.",
				};
			}

			// Load song, analysis, audio, and match details in parallel — all keyed
			// off the server-read songId and sourceSnapshotId from the owned item.
			const [
				songRow,
				analysisRow,
				audioRow,
				songDetailsResult,
				decisionsResult,
			] = await Promise.all([
				supabase.from("song").select("*").eq("id", songId).single(),
				supabase
					.from("song_analysis")
					.select("analysis")
					.eq("song_id", songId)
					.order("created_at", { ascending: false })
					.limit(1)
					.maybeSingle(),
				supabase
					.from("song_audio_feature")
					.select("tempo, energy, valence")
					.eq("song_id", songId)
					.maybeSingle(),
				getMatchResultDetailsForSong(item.sourceSnapshotId, songId),
				getMatchDecisionsForSongs(session.accountId, [songId]),
			]);

			if (songRow.error || !songRow.data) {
				return {
					status: "unavailable",
					itemId,
					reason: "missing-song",
					message: "This song could not be found.",
				};
			}

			if (
				Result.isError(songDetailsResult) ||
				Result.isError(decisionsResult)
			) {
				return {
					status: "retryable-error",
					itemId,
					message: "Could not load match data for this song.",
				};
			}

			const song = songRow.data;
			const audio = audioRow.data;
			const analysis = analysisRow.data?.analysis as MatchingSong["analysis"];

			const builtSong: MatchingSong = {
				id: song.id,
				spotifyId: song.spotify_id,
				name: song.name,
				artist: song.artists[0] ?? "Unknown Artist",
				album: song.album_name,
				albumArtUrl: song.image_url,
				genres: song.genres,
				audioFeatures: audio
					? { tempo: audio.tempo, energy: audio.energy, valence: audio.valence }
					: null,
				analysis: analysis ?? null,
			};

			// Apply the SESSION'S stored strictness (not a live re-read) and exclude
			// already-decided pairs, keyed off the server-read songId.
			const decidedPairs = new Set(
				decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
			);

			const visibleMatchResults = songDetailsResult.value.filter(
				(mr) =>
					mr.score >= strictnessMinScore &&
					!decidedPairs.has(`${songId}:${mr.playlist_id}`),
			);

			if (visibleMatchResults.length === 0) {
				return {
					status: "unavailable",
					itemId,
					reason: "no-visible-suggestions",
					message:
						"No playlist matches are visible under your current settings.",
				};
			}

			const playlistIds = visibleMatchResults.map((mr) => mr.playlist_id);
			const { data: playlistRows, error: playlistError } = await supabase
				.from("playlist")
				.select("id, name, match_intent, song_count, image_url, spotify_id")
				.in("id", playlistIds);

			if (playlistError || !playlistRows) {
				return {
					status: "retryable-error",
					itemId,
					message: "Could not load playlist data.",
				};
			}

			const playlistMap = new Map(playlistRows.map((p) => [p.id, p]));

			const matches: MatchingPlaylistMatch[] = visibleMatchResults
				.map((mr) => {
					const playlist = playlistMap.get(mr.playlist_id);
					if (!playlist) return null;
					return {
						playlist: {
							id: playlist.id,
							name: playlist.name,
							description: playlist.match_intent,
							trackCount: playlist.song_count,
							imageUrl: playlist.image_url,
							spotifyId: playlist.spotify_id,
						},
						score: mr.score,
						rank: mr.rank,
						factors: mr.factors,
					};
				})
				.filter((m): m is MatchingPlaylistMatch => m !== null)
				.toSorted((a, b) => b.score - a.score);

			return {
				status: "ready",
				itemId,
				mode: "song" as const,
				reviewItem: builtSong,
				suggestions: matches,
			};
		} catch {
			// Unexpected DB or runtime failures must not leak internals.
			return {
				status: "retryable-error",
				itemId,
				message: "An unexpected error occurred.",
			};
		}
	});

const PresentMatchReviewItemSchema = z.object({
	itemId: z.uuid(),
});

/**
 * Authoritative card presentation: derives the visible suggestion list (MSR-22),
 * atomically captures it (MSR-23), then returns render-ready song and playlist
 * data keyed off captured rows.
 *
 * Side effects: sets queue item active, writes visible pair rows, clears song
 * newness on song-mode presentation (idempotent, best-effort).
 *
 * First-write-wins capture: retries return the stored pair rows without
 * recomputing the visible set. This is the ONLY authoritative presentation
 * path — getMatchReviewItem is side-effect-free prefetch only (D9, D10).
 */
export const presentMatchReviewItem = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => PresentMatchReviewItemSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewItemRead> => {
		const { session } = context;
		const { itemId } = data;

		try {
			// Ownership check: load item by id AND account_id in one query. Foreign
			// or missing items return unavailable without leaking id existence.
			const item = await fetchOwnedQueueItem(itemId, session.accountId);
			if (!item) {
				return {
					status: "unavailable",
					itemId,
					reason: "not-entitled",
					message: "Item not found.",
				};
			}

			// Load session's stored strictness — must not re-read live preferences so
			// the bar matches what was visible when the queue was built.
			const supabase = createAdminSupabaseClient();
			const { data: sessionRow, error: sessionError } = await supabase
				.from("match_review_session")
				.select("strictness_min_score")
				.eq("id", item.sessionId)
				.eq("account_id", session.accountId)
				.maybeSingle();

			if (sessionError || !sessionRow) {
				return {
					status: "unavailable",
					itemId,
					reason: "snapshot-not-owned",
					message: "This item's session could not be verified.",
				};
			}

			const strictnessMinScore = sessionRow.strictness_min_score;

			// Derive the visible suggestion list (MSR-22 authority). This is the
			// only derivation path — capture and downstream paths must not re-derive.
			const listResult = await computeVisibleSuggestionList(
				item,
				strictnessMinScore,
			);

			if (listResult.kind === "not-entitled") {
				const message =
					listResult.reason === "song-not-entitled"
						? "This song is no longer available to match." // H6
						: "This playlist is no longer available to match."; // H6
				return {
					status: "unavailable",
					itemId,
					reason: "not-entitled",
					message,
				};
			}

			if (listResult.kind === "db-error") {
				return {
					status: "retryable-error",
					itemId,
					message: "Couldn't load this match card. Try again.", // H7
				};
			}

			const { list } = listResult;

			// Atomically capture the visible pairs (MSR-23 first-write-wins RPC).
			// Retries return the original captured rows so visible ranks are stable.
			const captureResult = await captureVisiblePairsAtomic(
				itemId,
				session.accountId,
				list.suggestions,
			);

			// Determine the active suggestion set from the capture result. On retry
			// the already_captured pairs are authoritative — the fresh derivation
			// above is discarded in favour of the stored rows.
			type SuggestionEntry = {
				songId: string;
				playlistId: string;
				fitScore: number;
				visibleRank: number;
			};
			let activeSuggestions: SuggestionEntry[];

			if (captureResult.status === "captured") {
				activeSuggestions = list.suggestions.map((s) => ({
					songId: s.songId,
					playlistId: s.playlistId,
					fitScore: s.fitScore,
					visibleRank: s.visibleRank,
				}));
			} else if (captureResult.status === "already_captured") {
				activeSuggestions = captureResult.pairs.map((p) => ({
					songId: p.songId,
					playlistId: p.playlistId,
					fitScore: p.fitScore,
					visibleRank: p.visibleRank,
				}));
			} else if (captureResult.status === "empty") {
				return {
					status: "unavailable",
					itemId,
					reason: "no-visible-suggestions",
					message:
						"No playlist matches are visible under your current settings.",
				};
			} else if (captureResult.status === "not_found") {
				return {
					status: "unavailable",
					itemId,
					reason: "not-entitled",
					message: "Item not found.",
				};
			} else if (captureResult.status === "already_resolved") {
				return {
					status: "unavailable",
					itemId,
					reason: "already-resolved",
					message: "This item has already been resolved.",
				};
			} else {
				// invalid_input or db-error — retryable per H7.
				return {
					status: "retryable-error",
					itemId,
					message: "Couldn't load this match card. Try again.",
				};
			}

			// An already_captured retry with zero stored pairs mirrors the empty
			// outcome — surface as no-visible-suggestions rather than ready with [].
			if (activeSuggestions.length === 0) {
				return {
					status: "unavailable",
					itemId,
					reason: "no-visible-suggestions",
					message:
						"No playlist matches are visible under your current settings.",
				};
			}

			// Build render-ready data keyed off the active suggestion set.
			if (list.orientation === "song" && list.subject.orientation === "song") {
				const songId = list.subject.songId;

				// Clear song newness on song-mode presentation — idempotent upsert.
				// Best-effort: a failure must not fail the presentation.
				const now = new Date().toISOString();
				await clearSongNewness(session.accountId, songId, now);

				const playlistIds = activeSuggestions.map((s) => s.playlistId);

				const [songRow, audioRow, analysisRow, playlistResult] =
					await Promise.all([
						supabase.from("song").select("*").eq("id", songId).single(),
						supabase
							.from("song_audio_feature")
							.select("tempo, energy, valence")
							.eq("song_id", songId)
							.maybeSingle(),
						supabase
							.from("song_analysis")
							.select("analysis")
							.eq("song_id", songId)
							.order("created_at", { ascending: false })
							.limit(1)
							.maybeSingle(),
						supabase
							.from("playlist")
							.select(
								"id, name, match_intent, song_count, image_url, spotify_id",
							)
							.in("id", playlistIds),
					]);

				if (songRow.error || !songRow.data) {
					return {
						status: "unavailable",
						itemId,
						reason: "missing-song",
						message: "This song could not be found.",
					};
				}

				if (playlistResult.error) {
					return {
						status: "retryable-error",
						itemId,
						message: "Couldn't load this match card. Try again.",
					};
				}

				const song = songRow.data;
				const audio = audioRow.data;
				const analysis = analysisRow.data?.analysis as
					| MatchingSong["analysis"]
					| undefined;

				const reviewItem: MatchingSong = {
					id: song.id,
					spotifyId: song.spotify_id,
					name: song.name,
					artist: song.artists[0] ?? "Unknown Artist",
					album: song.album_name,
					albumArtUrl: song.image_url,
					genres: song.genres,
					audioFeatures: audio
						? {
								tempo: audio.tempo,
								energy: audio.energy,
								valence: audio.valence,
							}
						: null,
					analysis: analysis ?? null,
				};

				const playlistMap = new Map(
					(playlistResult.data ?? []).map((p) => [p.id, p]),
				);

				// activeSuggestions arrives ordered by visibleRank from the capture RPC.
				const suggestions: MatchingPlaylistMatch[] = [];
				for (const s of activeSuggestions
					.slice()
					.sort((a, b) => a.visibleRank - b.visibleRank)) {
					const playlist = playlistMap.get(s.playlistId);
					if (!playlist) continue;
					suggestions.push({
						playlist: {
							id: playlist.id,
							name: playlist.name,
							description: playlist.match_intent,
							trackCount: playlist.song_count,
							imageUrl: playlist.image_url,
							spotifyId: playlist.spotify_id,
						},
						score: s.fitScore,
						rank: s.visibleRank,
						// Captured pair rows do not store match_result.factors — that
						// diagnostic field is not needed for card render (MSR-24 deviation).
						factors: null,
					});
				}

				return {
					status: "ready",
					itemId,
					mode: "song",
					reviewItem,
					suggestions,
				};
			}

			// Playlist mode is not implemented in this story.
			return {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			};
		} catch {
			// Unexpected DB or runtime failures must not leak internals.
			return {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			};
		}
	});

const MarkPresentedSchema = z.object({
	itemId: z.uuid(),
});

/**
 * Marks the queue item as presented — sets state=presented, records
 * presented_at, and clears newness for the song durably.
 */
export const markMatchReviewItemPresented = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => MarkPresentedSchema.parse(data))
	.handler(
		async ({ data, context }): Promise<MatchReviewItemPresentedResult> => {
			const { session } = context;
			const { itemId } = data;

			// Ownership check before any mutation — must confirm the item belongs to
			// this account before writing the presented state.
			const item = await fetchOwnedQueueItem(itemId, session.accountId);
			if (!item) {
				return { success: false, itemId, state: "unknown" };
			}

			// Song-mode only for now; playlist items are not yet presented via this path.
			const songId =
				item.subject.orientation === "song" ? item.subject.songId : null;
			if (!songId) {
				return { success: false, itemId, state: item.state };
			}

			const result = await markItemPresented(itemId, session.accountId, songId);
			if (Result.isError(result)) {
				return { success: false, itemId, state: item.state };
			}

			// null means the conditional update matched no eligible row: the item is
			// already resolved or raced with finish/dismiss. Report failure with the
			// item's current state rather than resurrecting it to "presented".
			if (result.value === null) {
				return { success: false, itemId, state: item.state };
			}

			return { success: true, itemId, state: result.value.state };
		},
	);

// ============================================================================
// Queue-aware mutations (Phase 4)
// ============================================================================

// No RESOLVED_STATES set needed — the B9-C lifecycle split means `state === 'resolved'`
// is the single terminal check for both add and dismiss guards.

const AddFromQueueSchema = z.object({
	itemId: z.uuid(),
	playlistId: z.uuid(),
});

export interface AddFromQueueResult {
	success: boolean;
	/** Populated when success is false, to distinguish errors from rejections. */
	reason?:
		| "not-found"
		| "already-resolved"
		| "not-entitled"
		| "foreign-playlist";
}

/**
 * Adds the song from a queue item to a playlist and writes a decision linked
 * to the item. Does NOT advance/resolve the card — the user may add to
 * multiple playlists before finishing.
 *
 * Security: songId and source_snapshot_id come from the server-owned queue item
 * row, never from client input. playlistId is verified to belong to the account.
 */
export const addSongToPlaylistFromQueueItem = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => AddFromQueueSchema.parse(data))
	.handler(async ({ data, context }): Promise<AddFromQueueResult> => {
		const { session } = context;
		const { itemId, playlistId } = data;

		const item = await fetchOwnedQueueItem(itemId, session.accountId);
		if (!item) {
			return { success: false, reason: "not-found" };
		}

		if (item.state === "resolved") {
			return { success: false, reason: "already-resolved" };
		}

		// Song-mode only: the add-to-playlist action is a song decision. Playlist
		// items use a different add path (not yet implemented in this story).
		if (item.subject.orientation !== "song") {
			return { success: false, reason: "not-found" };
		}
		const songId = item.subject.songId;

		// Resolve the served rank from the snapshot the user was looking at —
		// mirrors resolveServedContext in matching.functions but keyed off the
		// server-read song_id and source_snapshot_id from the owned item.
		const servedResult = await getServedRanksForSong(
			item.sourceSnapshotId,
			session.accountId,
			songId,
		);
		const rankByPlaylist = new Map<string, number>();
		if (Result.isOk(servedResult) && servedResult.value) {
			for (const mr of servedResult.value) {
				if (mr.rank !== null) rankByPlaylist.set(mr.playlist_id, mr.rank);
			}
		}

		// The RPC locks the queue row, rejects resolved items, re-checks playlist
		// ownership/entitlement, and writes the add decision in one transaction.
		// That serializes add with finish/dismiss across tabs and retries.
		const result = await addQueueItemDecisionAtomically(
			itemId,
			session.accountId,
			playlistId,
			rankByPlaylist.get(playlistId) ?? null,
		);
		if (Result.isError(result)) return { success: false };

		if (result.value === "added") return { success: true };
		if (result.value === "not_found") {
			return { success: false, reason: "not-found" };
		}
		if (result.value === "already_resolved") {
			return { success: false, reason: "already-resolved" };
		}
		if (result.value === "not_entitled") {
			return { success: false, reason: "not-entitled" };
		}
		return { success: false, reason: "foreign-playlist" };
	});

const DismissQueueSchema = z.object({
	itemId: z.uuid(),
});

export interface DismissQueueResult {
	success: boolean;
	reason?:
		| "not-found"
		| "already-resolved"
		| "derive-failed"
		| "decision-write-failed";
}

/**
 * Dismisses a queue item: the server derives all VISIBLE undecided playlist
 * matches from the item's source snapshot and stored session strictness, then a
 * single DB transaction resolves the item and writes dismissed decisions for the
 * pairs that were still undecided when the transaction won the queue-row lock.
 *
 * The visible-match derivation mirrors getMatchReviewItem — playlist ids come
 * entirely from server-owned data, never from client input.
 */
export const dismissMatchReviewItem = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => DismissQueueSchema.parse(data))
	.handler(async ({ data, context }): Promise<DismissQueueResult> => {
		const { session } = context;
		const { itemId } = data;

		const item = await fetchOwnedQueueItem(itemId, session.accountId);
		if (!item) {
			return { success: false, reason: "not-found" };
		}

		if (item.state === "resolved") {
			return { success: false, reason: "already-resolved" };
		}

		// Song-mode only: the dismiss path derives undecided playlist pairs for a
		// song subject. Playlist items use a different dismiss path (not yet
		// implemented in this story).
		if (item.subject.orientation !== "song") {
			return { success: false, reason: "not-found" };
		}
		const songId = item.subject.songId;

		// Load the session's stored strictness — must not re-read live preferences
		// so that the bar matches what was visible on screen when the user dismissed.
		const supabase = createAdminSupabaseClient();
		const { data: sessionRow, error: sessionError } = await supabase
			.from("match_review_session")
			.select("strictness_min_score")
			.eq("id", item.sessionId)
			.eq("account_id", session.accountId)
			.maybeSingle();

		if (sessionError || !sessionRow) {
			// The strictness that was on screen can't be verified. Falling back to 0
			// would derive a wider set of "visible" matches than the user actually
			// saw and write dismissed decisions for playlists they never reviewed.
			// Bail without writing decisions or resolving so the dismiss can retry.
			return { success: false, reason: "derive-failed" };
		}

		const strictnessMinScore = sessionRow.strictness_min_score;

		// Derive visible undecided playlist matches — same computation as
		// getMatchReviewItem so the dismissed set is exactly what was on screen.
		const [songDetailsResult, decisionsResult] = await Promise.all([
			getMatchResultDetailsForSong(item.sourceSnapshotId, songId),
			getMatchDecisionsForSongs(session.accountId, [songId]),
		]);

		if (Result.isError(songDetailsResult) || Result.isError(decisionsResult)) {
			// Derivation failed — do NOT resolve the item. Marking it completed here
			// would permanently block retries (RESOLVED_STATES guard fires on the next
			// call) while no decisions were ever written, creating a permanent
			// inconsistency. Leave the item pending so the user can retry.
			return { success: false, reason: "derive-failed" };
		}

		const decidedPairs = new Set(
			decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
		);

		const visibleUndecided = songDetailsResult.value.filter(
			(mr) =>
				mr.score >= strictnessMinScore &&
				!decidedPairs.has(`${songId}:${mr.playlist_id}`),
		);

		// Served ranks for those playlists, so dismissed decisions log the same
		// served context (snapshot + rank) that add decisions record.
		const servedResult =
			visibleUndecided.length > 0
				? await getServedRanksForSong(
						item.sourceSnapshotId,
						session.accountId,
						songId,
					)
				: null;
		const rankByPlaylist = new Map<string, number>();
		if (servedResult && Result.isOk(servedResult) && servedResult.value) {
			for (const mr of servedResult.value) {
				if (mr.rank !== null) rankByPlaylist.set(mr.playlist_id, mr.rank);
			}
		}

		const decisions = visibleUndecided.map((mr) => ({
			playlistId: mr.playlist_id,
			modelRank: rankByPlaylist.get(mr.playlist_id) ?? null,
		}));

		const dismissResult = await dismissQueueItemAtomically(
			itemId,
			session.accountId,
			decisions,
		);
		if (Result.isError(dismissResult)) {
			return { success: false, reason: "decision-write-failed" };
		}

		if (dismissResult.value === "not_found") {
			return { success: false, reason: "not-found" };
		}
		if (dismissResult.value === "already_resolved") {
			return { success: false, reason: "already-resolved" };
		}
		if (dismissResult.value === "invalid_input") {
			return { success: false, reason: "decision-write-failed" };
		}

		return { success: true };
	});

const FinishQueueSchema = z.object({
	itemId: z.uuid(),
});

export interface FinishQueueResult {
	success: boolean;
	resolution?: "added" | "skipped";
	reason?: "not-found" | "already-resolved" | "decision-count-failed";
}

/**
 * Finishes a queue card (the "Next Song" action).
 *
 * Delegates to an atomic RPC that locks the queue item, counts add decisions
 * linked to this queue_item_id, then resolves the item. Add takes the same lock
 * before writing, so finish cannot miss an in-flight add.
 *
 * - ≥1 add found → completed/added
 * - 0 adds found → skipped/skipped (no negative decisions written)
 */
export const finishMatchReviewItem = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => FinishQueueSchema.parse(data))
	.handler(async ({ data, context }): Promise<FinishQueueResult> => {
		const { session } = context;
		const { itemId } = data;

		// The RPC locks the queue row before counting linked add decisions. Because
		// add also takes the same lock before writing, finish cannot resolve as
		// skipped while an add decision is in flight.
		const result = await finishQueueItemAtomically(itemId, session.accountId);
		if (Result.isError(result)) {
			return { success: false, reason: "decision-count-failed" };
		}

		if (result.value === "not_found") {
			return { success: false, reason: "not-found" };
		}
		if (result.value === "already_resolved") {
			return { success: false, reason: "already-resolved" };
		}
		if (result.value === "completed_added") {
			return { success: true, resolution: "added" };
		}
		return { success: true, resolution: "skipped" };
	});

// ============================================================================
// Queue summary (Phase 7 — dashboard CTA, sidebar badge, empty-state)
// ============================================================================

export interface MatchReviewSummaryResult {
	pendingCount: number;
	previewImages: Array<{
		id: number;
		image: string;
		name: string;
		artist: string;
	}>;
	hasActiveQueue: boolean;
	/** Which orientation this summary reflects — used by the sidebar/dashboard to
	 *  build the correct Match link (/match vs /match?mode=playlist). */
	orientation: MatchOrientation;
}

/**
 * Resolves the queue-aware match review summary for a specific orientation.
 *
 * Active-queue path: asks the domain for the pending count and top-3 song ids,
 * then maps ids → image_url rows.
 *
 * Snapshot-fallback path (no active queue): derives count and preview ids from
 * the latest snapshot using getOrderedUndecidedSongIds — the same ordering
 * authority as the /match walk — without creating a queue. Queue creation
 * happens only on /match entry via startOrResumeMatchReview.
 *
 * Exported so dashboard.functions.ts can call it once and share the result
 * across both the CTA count and the preview fan.
 */
export async function resolveMatchReviewSummary(
	accountId: string,
	orientation: MatchOrientation,
): Promise<MatchReviewSummaryResult> {
	const summaryResult = await getQueueSummary(accountId, orientation);

	let topIds: string[];
	let pendingCount: number;
	let hasActiveQueue: boolean;

	if (Result.isOk(summaryResult) && summaryResult.value.hasActiveQueue) {
		const summary = summaryResult.value;
		pendingCount = summary.pendingCount;
		hasActiveQueue = true;
		topIds = summary.previewSongIds.slice(0, 3);
	} else {
		// No active queue — fall back to the latest-snapshot ordering authority so
		// the dashboard previews stay identical to the pre-queue behaviour. We do
		// NOT create a queue here; that is deferred to /match entry.
		hasActiveQueue = false;
		const snapshotResult = await getLatestMatchSnapshot(accountId);
		if (Result.isError(snapshotResult) || !snapshotResult.value) {
			return {
				pendingCount: 0,
				previewImages: [],
				hasActiveQueue: false,
				orientation,
			};
		}

		const { songIds } = await getOrderedUndecidedSongIds(
			snapshotResult.value.id,
			accountId,
		);
		pendingCount = songIds.length;
		topIds = songIds.slice(0, 3);
	}

	if (topIds.length === 0) {
		return { pendingCount, previewImages: [], hasActiveQueue, orientation };
	}

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("song")
		.select("id, image_url, name, artists")
		.in("id", topIds);

	if (error || !data) {
		return { pendingCount, previewImages: [], hasActiveQueue, orientation };
	}

	const songMap = new Map(data.map((s) => [s.id, s]));
	const previewImages = topIds
		.map((id, i) => {
			const song = songMap.get(id);
			return song?.image_url
				? {
						id: i + 1,
						image: song.image_url,
						name: song.name,
						artist: song.artists[0] ?? "Unknown Artist",
					}
				: null;
		})
		.filter(
			(p): p is MatchReviewSummaryResult["previewImages"][number] => p !== null,
		);

	return { pendingCount, previewImages, hasActiveQueue, orientation };
}

const GetMatchReviewSummarySchema = z.object({
	orientation: MatchOrientationSchema,
});

/**
 * Returns the queue-aware match review summary.
 * Backs the sidebar badge and is available for targeted refetch.
 * Dashboard uses resolveMatchReviewSummary directly (no extra HTTP round-trip).
 */
export const getMatchReviewSummary = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => GetMatchReviewSummarySchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewSummaryResult> => {
		return resolveMatchReviewSummary(
			context.session.accountId,
			data.orientation,
		);
	});

/**
 * Reads the account's stored match_view_mode preference and delegates to
 * resolveMatchReviewSummary with that orientation. Falls back to 'song' when the
 * preference row is missing or unreadable. Used by dashboard + sidebar so those
 * surfaces always reflect the user's last-selected mode without needing the mode
 * passed explicitly from the client.
 */
export async function resolvePreferredMatchReviewSummary(
	accountId: string,
): Promise<MatchReviewSummaryResult> {
	const mode = await getPreferredMatchViewMode(accountId);
	return resolveMatchReviewSummary(accountId, mode);
}

/**
 * Server function version of resolvePreferredMatchReviewSummary.
 * Backs preferredSummary query key — invalidated after a preference update.
 */
export const getPreferredMatchReviewSummary = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<MatchReviewSummaryResult> => {
		return resolvePreferredMatchReviewSummary(context.session.accountId);
	});

export interface SyncActiveMatchReviewSessionsResult {
	results: Array<{ orientation: MatchOrientation; appendedCount: number }>;
}

// All orientations that can have active sessions. Both are synced in each
// background-refresh cycle so no newly-appended items are missed by the queue.
const ALL_ORIENTATIONS: readonly MatchOrientation[] = ["song", "playlist"];

/**
 * Appends the latest snapshot's eligible subjects to all active review queues.
 * Replaces the singular syncActiveMatchReviewSession: syncs every orientation
 * in one call so a single server round-trip handles both song and playlist
 * sessions after a background match snapshot refresh completes.
 *
 * Idempotent: the domain layer guards against re-applying the same snapshot
 * via the (session_id, snapshot_id, visibility_config_hash) composite key.
 * Returns appendedCount: 0 for any orientation without an active session.
 */
export const syncActiveMatchReviewSessions = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(
		async ({ context }): Promise<SyncActiveMatchReviewSessionsResult> => {
			const { session } = context;

			const results: Array<{
				orientation: MatchOrientation;
				appendedCount: number;
			}> = [];

			for (const orientation of ALL_ORIENTATIONS) {
				const result = await syncActiveQueue(session.accountId, orientation);
				results.push({
					orientation,
					appendedCount: Result.isOk(result) ? result.value.appendedCount : 0,
				});
			}

			return { results };
		},
	);
