/**
 * The public Match deck contract (plan §4) and the pure mappers from the deck
 * RPC payloads (deck-read-queries.ts) onto it. Shared by the deck entry, the
 * deck server fns, and the client that renders the cards.
 */

import * as Sentry from "@sentry/cloudflare";
import type { Json } from "@/lib/data/database.types";
import { captureServerError } from "@/lib/observability/capture-server-error";
import {
	PLAYLIST_CARD_SUGGESTION_CAP,
	SONG_CARD_SUGGESTION_CAP,
} from "./card-suggestion-caps";
import type {
	ActiveMatchDeckRpcResult,
	DeckCardEnvelope,
	ReadMatchDeckCardRpcResult,
} from "./deck-read-queries";
import type { QueueItemSongSuggestionCursor } from "./queries";
import { deriveSuggestionNextCursor } from "./suggestion-cursor";
import type { MatchOrientation } from "./types";

// ============================================================================
// Card presentation shapes
// ============================================================================

export interface MatchingSong {
	id: string;
	spotifyId: string;
	name: string;
	artist: string;
	album: string | null;
	albumArtUrl: string | null;
	genres: string[];
	audioFeatures: {
		tempo: number | null;
		energy: number | null;
		valence: number | null;
	} | null;
	analysis: {
		headline: string;
		compound_mood: string;
		mood_description: string;
		interpretation: string;
		themes: Array<{ name: string; description: string }>;
		journey: Array<{ section: string; mood: string; description: string }>;
		key_lines: Array<{ line: string; insight: string }>;
		sonic_texture: string;
	} | null;
}

export interface MatchingPlaylistMatch {
	playlist: {
		id: string;
		name: string;
		description: string | null;
		trackCount: number | null;
		imageUrl: string | null;
		spotifyId: string;
	};
	score: number;
	rank: number | null;
	factors: Json;
}

/** Playlist subject shape for playlist-orientation review cards. */
export interface MatchingPlaylistForReview {
	id: string;
	spotifyId: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	trackCount: number | null;
}

/**
 * Song candidate row in playlist-mode: song data + fitScore for match percent display.
 * fitScore = strictnessScore(row) — never the reranker/ordering score (A5, E7).
 */
export interface MatchingSongSuggestion {
	song: MatchingSong;
	fitScore: number;
}

export type MatchReviewItemRead =
	| {
			status: "ready";
			itemId: string;
			// Song orientation: review subject is a song; suggestions are playlists.
			mode: "song";
			reviewItem: MatchingSong;
			suggestions: MatchingPlaylistMatch[];
			/** min(suggestion count, SONG_CARD_SUGGESTION_CAP). Mirrors the playlist
			 *  arm so both orientations share one pagination contract (R-D). */
			suggestionTotal: number;
			/** Always null in Phase 3: song suggestions are playlists and there is no
			 *  song-mode tail endpoint, so the (song-keyed) cursor is never emitted. */
			nextCursor: QueueItemSongSuggestionCursor | null;
	  }
	| {
			status: "ready";
			itemId: string;
			// Playlist orientation: review subject is a playlist; suggestions are songs.
			mode: "playlist";
			reviewItem: MatchingPlaylistForReview;
			// First page only (PLAYLIST_CARD_FIRST_PAGE_SIZE rows) — the rest pages in
			// via listMatchReviewItemSuggestions.
			suggestions: MatchingSongSuggestion[];
			/** min(post-dismissal active count, PLAYLIST_CARD_SUGGESTION_CAP) — read on
			 *  the cursorless first-page call only (see readQueueItemSongSuggestions). */
			suggestionTotal: number;
			/** Keyset cursor for the next tail page, or null when the first page was
			 *  the whole (capped) suggestion set. */
			nextCursor: QueueItemSongSuggestionCursor | null;
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

/**
 * Orientation-aware copy for the no-visible-suggestions card. A song-orientation
 * subject is matched against playlists; a playlist-orientation subject against
 * songs — so this must name the suggestion side. The UI renders itemData.message
 * verbatim, so a hard-coded "playlist matches" would mislabel a playlist card
 * whose missing suggestions are actually songs (A1 orientation correctness).
 */
export function noVisibleSuggestionsMessage(
	orientation: MatchOrientation,
): string {
	return orientation === "playlist"
		? "No song matches are visible under your current settings."
		: "No playlist matches are visible under your current settings.";
}

// ============================================================================
// Public deck contract (plan §4)
// ============================================================================

export type MatchDeckView = {
	version: 1;
	accountId: string;
	orientation: MatchOrientation;
	sessionId: string;
	snapshotId: string;
	visibilityConfigHash: string;
	revision: number;
	progress: {
		total: number;
		remaining: number;
		caughtUp: boolean;
		hiddenReviewItemCount: number;
	};
	/** Ordered unresolved item ids — the client-navigable timeline. */
	itemIds: string[];
	cards: {
		current: MatchDeckCard | null;
		next: MatchDeckCard | null;
	};
};

export type MatchDeckCard = {
	itemId: string;
	position: number;
	/** Reuses the existing card read union (ready | unavailable | retryable-error). */
	presentation: MatchReviewItemRead;
};

export type MatchDeckAction =
	| { type: "add-suggestion"; itemId: string; suggestionId: string }
	| { type: "dismiss-suggestion"; itemId: string; suggestionId: string }
	| { type: "finish-card"; itemId: string }
	| { type: "dismiss-card"; itemId: string };

/** No published snapshot yet — the existing building empty state (plan §8 step 4). */
export type MatchDeckBuildingState = { status: "building" };

export type StartOrResumeMatchDeckResult =
	| MatchDeckView
	| MatchDeckBuildingState;

/**
 * The action result surfaces the raw TEXT action status (R-A: never collapsed to
 * a bool) plus the fresh read-after-write view.
 */
export type SubmitMatchDeckActionResult = {
	actionStatus: string;
	view: StartOrResumeMatchDeckResult;
};

// ============================================================================
// Mappers
// ============================================================================

/**
 * First-page row count for a playlist deck card's suggestion list — mirrors the
 * private PLAYLIST_CARD_FIRST_PAGE_SIZE in match-review-queue.functions.ts (a
 * first-paint tuning number, not a shared contract). Song decks read the whole
 * capped set instead (nextCursor is always null there).
 */
const PLAYLIST_CARD_FIRST_PAGE_SIZE = 8;

/**
 * The suggestion window baked into the deck view's current/next cards. Playlist
 * decks are first-page-fast (tail pages via the suggestions infinite query);
 * song decks read the whole capped set in one shot (nextCursor always null).
 */
export function deckWindow(orientation: MatchOrientation): number {
	return orientation === "playlist"
		? PLAYLIST_CARD_FIRST_PAGE_SIZE
		: SONG_CARD_SUGGESTION_CAP;
}

/**
 * P1.1: mapReadDeckCardToItemRead is a pure mapper by design (no accountId
 * param — its own tests fabricate RPC shapes with zero side effects), so its
 * unrecognized-payload fallback (L3: unknown status, or a known status whose
 * payload drifted) can't capture itself. Hoisted here to every call site
 * instead, where accountId is in scope. `not_captured` is a known status: the
 * cold-after-R-E case is tracked via the match_deck_materialize_on_read product
 * event (resolveDeckCard), not a shape violation worth a Sentry capture.
 */
export function captureUnexpectedCardShape(
	accountId: string,
	itemId: string,
	rpc: ReadMatchDeckCardRpcResult,
): void {
	if (!("unrecognized" in rpc)) return;
	captureServerError(
		new Error(
			`read_match_deck_card mapped to retryable-error: status=${rpc.status} (unrecognized payload)`,
		),
		{
			area: "match_review_queue",
			operation: "map_read_deck_card_to_item_read",
			accountId,
			extra: { itemId, status: rpc.status },
		},
	);
}

/**
 * Maps one read_match_deck_card JSONB payload to the shared MatchReviewItemRead
 * union. The playlist arm reuses the shared suggestion-row mapping
 * (song suggestion rows → MatchingSongSuggestion, suggestionTotal capped, cursor
 * derived); the song arm mirrors it (playlist suggestion rows → MatchingPlaylistMatch,
 * nextCursor always null per R-D). `not_captured` maps to retryable-error — the
 * readMatchDeckCard server fn recovers it on-demand (R-E) before the map runs.
 *
 * `orientation` sources the no_visible_suggestions copy, which must name the
 * suggestion side, not the subject. The read_match_deck_card payload doesn't
 * carry orientation on that
 * status, so the caller passes it: the deck view threads the single deck
 * orientation; the standalone card GET passes null when it can't derive one and
 * falls back to the orientation-neutral copy rather than risk mislabeling.
 */
export function mapReadDeckCardToItemRead(
	rpc: ReadMatchDeckCardRpcResult,
	itemId: string,
	pageSize: number,
	orientation: MatchOrientation | null,
): MatchReviewItemRead {
	if ("unrecognized" in rpc) return retryableCard(itemId);
	switch (rpc.status) {
		case "ready": {
			if ("song" in rpc) {
				const song = rpc.song;
				const reviewItem: MatchingSong = {
					id: song.id,
					spotifyId: song.spotify_id,
					name: song.name,
					artist: song.artists[0] ?? "Unknown Artist",
					album: song.album_name,
					albumArtUrl: song.image_url,
					genres: song.genres,
					audioFeatures: song.audio_feature
						? {
								tempo: song.audio_feature.tempo,
								energy: song.audio_feature.energy,
								valence: song.audio_feature.valence,
							}
						: null,
					// The stored analysis is versioned jsonb this card type doesn't
					// decode; it reaches the client as stored.
					analysis: (song.analysis ?? null) as MatchingSong["analysis"] | null,
				};
				const suggestions: MatchingPlaylistMatch[] = rpc.suggestions.map(
					(row) => ({
						playlist: {
							id: row.playlist_id,
							name: row.name,
							description: row.match_intent,
							trackCount: row.song_count,
							imageUrl: row.image_url,
							spotifyId: row.spotify_id,
						},
						score: row.fit_score,
						rank: row.visible_rank,
						// factors are not stored in capture rows and not needed for render.
						factors: null,
					}),
				);
				return {
					status: "ready",
					itemId,
					mode: "song",
					reviewItem,
					suggestions,
					suggestionTotal: Math.min(
						rpc.total_active_count,
						SONG_CARD_SUGGESTION_CAP,
					),
					nextCursor: null,
				};
			}
			const pl = rpc.playlist;
			const reviewItem: MatchingPlaylistForReview = {
				id: pl.id,
				spotifyId: pl.spotify_id,
				name: pl.name,
				description: pl.match_intent,
				imageUrl: pl.image_url,
				trackCount: pl.song_count,
			};
			const songRows = rpc.suggestions;
			const suggestions: MatchingSongSuggestion[] = songRows.map((row) => ({
				song: {
					id: row.song_id,
					spotifyId: row.spotify_id,
					name: row.name,
					artist: row.artists[0] ?? "Unknown Artist",
					album: row.album_name,
					albumArtUrl: row.image_url,
					genres: row.genres,
					// Audio features + analysis are not surfaced on the playlist-mode
					// card; fetching them would add joins with no UI benefit.
					audioFeatures: null,
					analysis: null,
				},
				// fitScore = strictnessScore from the captured pair (A5, E7).
				fitScore: row.fit_score,
			}));
			const suggestionTotal = Math.min(
				rpc.total_active_count,
				PLAYLIST_CARD_SUGGESTION_CAP,
			);
			return {
				status: "ready",
				itemId,
				mode: "playlist",
				reviewItem,
				suggestions,
				suggestionTotal,
				nextCursor: deriveSuggestionNextCursor(
					songRows.map((r) => ({
						fitScore: r.fit_score,
						modelRank: r.model_rank,
						songId: r.song_id,
					})),
					pageSize,
					suggestionTotal,
				),
			};
		}
		case "not_found":
			return {
				status: "unavailable",
				itemId,
				reason: "not-entitled",
				message: "Item not found.",
			};
		case "playlist_gone":
			return {
				status: "unavailable",
				itemId,
				reason: "not-entitled",
				message: "This playlist is no longer available to match.",
			};
		case "song_gone":
			return {
				status: "unavailable",
				itemId,
				reason: "not-entitled",
				message: "This song is no longer available to match.",
			};
		case "no_visible_suggestions":
			return {
				status: "unavailable",
				itemId,
				reason: "no-visible-suggestions",
				message: orientation
					? noVisibleSuggestionsMessage(orientation)
					: "No matches are visible under your current settings.",
			};
		case "not_captured":
			// Cold path after R-E couldn't recover — retryable so the client re-fetches.
			return retryableCard(itemId);
	}
}

function retryableCard(itemId: string): MatchReviewItemRead {
	return {
		status: "retryable-error",
		itemId,
		message: "Couldn't load this match card. Try again.",
	};
}

function mapCardEnvelope(
	env: DeckCardEnvelope | null,
	pageSize: number,
	orientation: MatchOrientation,
	accountId: string,
): MatchDeckCard | null {
	if (!env) return null;
	captureUnexpectedCardShape(accountId, env.itemId, env.presentation);
	return {
		itemId: env.itemId,
		position: env.position,
		presentation: mapReadDeckCardToItemRead(
			env.presentation,
			env.itemId,
			pageSize,
			orientation,
		),
	};
}

/**
 * Maps an ACTIVE start_or_resume_match_deck payload to the public MatchDeckView.
 * `snapshotId` is coerced from null → "" with a Sentry breadcrumb (R-F): plan §4
 * types it string, but a legacy active session can return null; coercing (the
 * EMPTY_MATCH_REVIEW_RESULT.sessionId precedent) keeps downstream cache keys
 * stable and never throws.
 */
export function mapStartOrResumeToView(
	rpc: ActiveMatchDeckRpcResult,
	pageSize: number,
): MatchDeckView {
	const orientation = rpc.orientation;

	let snapshotId = rpc.snapshotId;
	if (snapshotId === null) {
		Sentry.addBreadcrumb({
			category: "match_deck",
			level: "warning",
			message:
				"start_or_resume_match_deck returned null snapshotId; coerced to ''",
			data: {
				accountId: rpc.accountId,
				orientation,
				sessionId: rpc.sessionId,
			},
		});
		snapshotId = "";
	}

	return {
		version: 1,
		accountId: rpc.accountId,
		orientation,
		sessionId: rpc.sessionId,
		snapshotId,
		visibilityConfigHash: rpc.visibilityConfigHash ?? "",
		revision: rpc.revision,
		progress: {
			total: rpc.progress.total,
			remaining: rpc.progress.remaining,
			caughtUp: rpc.progress.caughtUp,
			hiddenReviewItemCount: rpc.progress.hiddenReviewItemCount,
		},
		itemIds: rpc.itemIds,
		cards: {
			current: mapCardEnvelope(
				rpc.cards.current,
				pageSize,
				orientation,
				rpc.accountId,
			),
			next: mapCardEnvelope(
				rpc.cards.next,
				pageSize,
				orientation,
				rpc.accountId,
			),
		},
	};
}
