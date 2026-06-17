import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import {
	addQueueItemDecisionAtomically,
	dismissQueueItemAtomically,
	fetchActiveSession,
	fetchQueueItems,
	finishQueueItemAtomically,
} from "@/lib/domains/taste/match-review-queue/queries";
import {
	createOrResumeQueue,
	getQueueSummary,
	markItemPresented,
	syncActiveQueue,
} from "@/lib/domains/taste/match-review-queue/service";
import type {
	AppendResult,
	MatchReviewQueueItem,
} from "@/lib/domains/taste/match-review-queue/types";
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
			song: MatchingSong;
			matches: MatchingPlaylistMatch[];
	  }
	| {
			status: "unavailable";
			itemId: string;
			reason:
				| "not-entitled"
				| "missing-song"
				| "snapshot-not-owned"
				| "no-visible-matches";
			message: string;
	  }
	| {
			status: "error";
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
 */
async function fetchOwnedQueueItem(
	itemId: string,
	accountId: string,
): Promise<MatchReviewQueueItem | null> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("match_review_queue_item")
		.select("*")
		.eq("id", itemId)
		.eq("account_id", accountId)
		.maybeSingle();

	if (error || !data) return null;

	return {
		id: data.id,
		sessionId: data.session_id,
		accountId: data.account_id,
		songId: data.song_id,
		sourceSnapshotId: data.source_snapshot_id,
		position: data.position,
		state: data.state as MatchReviewQueueItem["state"],
		resolution: data.resolution as MatchReviewQueueItem["resolution"],
		sourceScore: data.source_score,
		wasNewAtEnqueue: data.was_new_at_enqueue,
		presentedAt: data.presented_at,
		resolvedAt: data.resolved_at,
		createdAt: data.created_at,
		updatedAt: data.updated_at,
	};
}

/** Derived from unresolved item count — never from null song data. */
function deriveCaughtUp(items: MatchReviewQueueItem[]): boolean {
	return items.every(
		(item) =>
			item.state === "completed" ||
			item.state === "skipped" ||
			item.state === "unavailable",
	);
}

/**
 * Creates or resumes the active queue for the authed account and returns the
 * session id + ordered item ids the route loader needs to bootstrap the card
 * stack. Thin wrapper: all queue logic lives in the domain service.
 */
export const startOrResumeMatchReview = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<MatchReviewStartResult> => {
		const { session } = context;

		const queueResult = await createOrResumeQueue(session.accountId);
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

/**
 * Returns the active session + ordered queue items with enough metadata for
 * the card stack. Caught-up state is derived from item states — never from
 * null song data.
 */
export const getMatchReview = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<MatchReviewResult | null> => {
		const { session } = context;

		const sessionResult = await fetchActiveSession(session.accountId);
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
					status: "error",
					itemId,
					message: "Item not found.",
				};
			}

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
				p_song_id: item.songId,
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
			// off the owned item's song_id and source_snapshot_id.
			const [
				songRow,
				analysisRow,
				audioRow,
				songDetailsResult,
				decisionsResult,
			] = await Promise.all([
				supabase.from("song").select("*").eq("id", item.songId).single(),
				supabase
					.from("song_analysis")
					.select("analysis")
					.eq("song_id", item.songId)
					.order("created_at", { ascending: false })
					.limit(1)
					.maybeSingle(),
				supabase
					.from("song_audio_feature")
					.select("tempo, energy, valence")
					.eq("song_id", item.songId)
					.maybeSingle(),
				getMatchResultDetailsForSong(item.sourceSnapshotId, item.songId),
				getMatchDecisionsForSongs(session.accountId, [item.songId]),
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
					status: "error",
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
			// already-decided pairs, keyed off the queue item.
			const decidedPairs = new Set(
				decisionsResult.value.map((d) => `${d.song_id}:${d.playlist_id}`),
			);

			const visibleMatchResults = songDetailsResult.value.filter(
				(mr) =>
					mr.score >= strictnessMinScore &&
					!decidedPairs.has(`${item.songId}:${mr.playlist_id}`),
			);

			if (visibleMatchResults.length === 0) {
				return {
					status: "unavailable",
					itemId,
					reason: "no-visible-matches",
					message:
						"No playlist matches are visible under your current settings.",
				};
			}

			const playlistIds = visibleMatchResults.map((mr) => mr.playlist_id);
			const { data: playlistRows, error: playlistError } = await supabase
				.from("playlist")
				.select("id, name, match_intent, song_count, spotify_id")
				.in("id", playlistIds);

			if (playlistError || !playlistRows) {
				return {
					status: "error",
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
				song: builtSong,
				matches,
			};
		} catch {
			// Unexpected DB or runtime failures must not leak internals.
			return {
				status: "error",
				itemId,
				message: "An unexpected error occurred.",
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

			const result = await markItemPresented(
				itemId,
				session.accountId,
				item.songId,
			);
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

/** Completed states that block further decisions from being recorded. */
const RESOLVED_STATES = new Set(["completed", "skipped", "unavailable"]);

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

		if (RESOLVED_STATES.has(item.state)) {
			return { success: false, reason: "already-resolved" };
		}

		// Resolve the served rank from the snapshot the user was looking at —
		// mirrors resolveServedContext in matching.functions but keyed off the
		// owned item's source_snapshot_id rather than a client-supplied value.
		const servedResult = await getServedRanksForSong(
			item.sourceSnapshotId,
			session.accountId,
			item.songId,
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

		if (RESOLVED_STATES.has(item.state)) {
			return { success: false, reason: "already-resolved" };
		}

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
			getMatchResultDetailsForSong(item.sourceSnapshotId, item.songId),
			getMatchDecisionsForSongs(session.accountId, [item.songId]),
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
				!decidedPairs.has(`${item.songId}:${mr.playlist_id}`),
		);

		// Served ranks for those playlists, so dismissed decisions log the same
		// served context (snapshot + rank) that add decisions record.
		const servedResult =
			visibleUndecided.length > 0
				? await getServedRanksForSong(
						item.sourceSnapshotId,
						session.accountId,
						item.songId,
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
			servedRank: rankByPlaylist.get(mr.playlist_id) ?? null,
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
	previewImages: Array<{ id: number; image: string }>;
	hasActiveQueue: boolean;
}

/**
 * Resolves the queue-aware match review summary.
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
): Promise<MatchReviewSummaryResult> {
	const summaryResult = await getQueueSummary(accountId);

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
			return { pendingCount: 0, previewImages: [], hasActiveQueue: false };
		}

		const { songIds } = await getOrderedUndecidedSongIds(
			snapshotResult.value.id,
			accountId,
		);
		pendingCount = songIds.length;
		topIds = songIds.slice(0, 3);
	}

	if (topIds.length === 0) {
		return { pendingCount, previewImages: [], hasActiveQueue };
	}

	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("song")
		.select("id, image_url")
		.in("id", topIds);

	if (error || !data) {
		return { pendingCount, previewImages: [], hasActiveQueue };
	}

	const imageMap = new Map(data.map((s) => [s.id, s.image_url]));
	const previewImages = topIds
		.map((id, i) => {
			const image = imageMap.get(id);
			return image ? { id: i + 1, image } : null;
		})
		.filter((p): p is { id: number; image: string } => p !== null);

	return { pendingCount, previewImages, hasActiveQueue };
}

/**
 * Returns the queue-aware match review summary.
 * Backs the sidebar badge and is available for targeted refetch.
 * Dashboard uses resolveMatchReviewSummary directly (no extra HTTP round-trip).
 */
export const getMatchReviewSummary = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<MatchReviewSummaryResult> => {
		return resolveMatchReviewSummary(context.session.accountId);
	});

/**
 * Appends the latest snapshot's eligible songs to the active review queue.
 * Called after a background match snapshot refresh completes so the queue
 * receives new matches without requiring a page reload.
 *
 * Idempotent: the domain layer guards against re-applying the same snapshot
 * via the (session_id, snapshot_id) PK on match_review_session_snapshot.
 * Returns { appendedCount: 0 } when no active queue exists for the account.
 */
export const syncActiveMatchReviewSession = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data: undefined) => NoInputSchema.parse(data))
	.handler(async ({ context }): Promise<AppendResult> => {
		const { session } = context;

		const result = await syncActiveQueue(session.accountId);
		if (Result.isError(result)) {
			return { appendedCount: 0, alreadyApplied: false };
		}

		return result.value;
	});
