/**
 * Phase 3 server contracts for the Match deck read model (plan §4/§7/§8/§9).
 *
 * The public deck contract lives here alongside three server fns:
 *   - startOrResumeMatchDeck — one bounded /match-entry call (plan §8). Active →
 *     the full MatchDeckView; miss + snapshot → approach-X first-window build
 *     (R-B); miss + no snapshot → the building empty state.
 *   - readMatchDeckCard — a pure card read with an on-demand materialize fallback
 *     for the not-yet-captured cold path (R-E).
 *   - submitMatchDeckAction — dispatch to the existing atomic domain wrappers
 *     (they already do the deck side effects in-txn and keep RETURNS TEXT), then
 *     read the fresh view (R-A: read-after-write, no return-type migration).
 *
 * This ships ALONGSIDE the legacy query families; nothing legacy is deleted here
 * (that is Phase 4/5). New RPCs are typed via the deck escape hatch until
 * `bun run gen:types` runs.
 */

import * as Sentry from "@sentry/cloudflare";
import { createServerFn } from "@tanstack/react-start";
import { Result } from "better-result";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { captureAheadForSession } from "@/lib/domains/taste/match-review-queue/card-materializer";
import {
	PLAYLIST_CARD_SUGGESTION_CAP,
	SONG_CARD_SUGGESTION_CAP,
} from "@/lib/domains/taste/match-review-queue/card-suggestion-caps";
import {
	callReadMatchDeckCard,
	callStartOrResumeMatchDeck,
	type DeckCardEnvelope,
	type DeckCardPlaylistSuggestionRow,
	type DeckCardSongSuggestionRow,
	type ReadMatchDeckCardRpcResult,
	type StartOrResumeMatchDeckRpcResult,
} from "@/lib/domains/taste/match-review-queue/deck-read-queries";
import {
	addQueueItemDecisionAtomically,
	dismissQueueItemAtomically,
	dismissQueueItemSuggestionAtomically,
	finishQueueItemAtomically,
	mapItemToDto,
} from "@/lib/domains/taste/match-review-queue/queries";
import { deriveSuggestionNextCursor } from "@/lib/domains/taste/match-review-queue/suggestion-cursor";
import type {
	MatchOrientation,
	MatchReviewQueueItemDto,
} from "@/lib/domains/taste/match-review-queue/types";
import { resolveVisibilityConfigHash } from "@/lib/domains/taste/match-review-queue/visibility-config-hash";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import {
	DEFAULT_MATCH_STRICTNESS,
	STRICTNESS_MIN_SCORE,
} from "@/lib/domains/taste/song-matching/strictness";
import { captureProductEventBestEffort } from "@/lib/observability/capture-product-event";
import { captureServerError } from "@/lib/observability/capture-server-error";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { buildFirstWindowAndPromote } from "./match-deck-miss-path";
import {
	type MatchReviewItemRead,
	noVisibleSuggestionsMessage,
} from "./match-review-queue.functions";
import type {
	MatchingPlaylistForReview,
	MatchingPlaylistMatch,
	MatchingSong,
	MatchingSongSuggestion,
} from "./matching.functions";

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
// Constants + small helpers
// ============================================================================

/**
 * First-page row count for a playlist deck card's suggestion list — mirrors the
 * private PLAYLIST_CARD_FIRST_PAGE_SIZE in match-review-queue.functions.ts (a
 * first-paint tuning number, not a shared contract). Song decks read the whole
 * capped set instead (nextCursor is always null there).
 */
const PLAYLIST_CARD_FIRST_PAGE_SIZE = 8;

/** Orientation is validated at every deck boundary, mirroring the queue fns. */
const OrientationSchema = z.enum(["song", "playlist"] as const);

function reportDeckError(
	error: unknown,
	operation: string,
	accountId: string,
	extra?: Record<string, unknown>,
): void {
	captureServerError(error, {
		area: "match_review_queue",
		operation,
		accountId,
		extra,
	});
}

function narrowOrientation(value: unknown): MatchOrientation | null {
	return value === "song" || value === "playlist" ? value : null;
}

/**
 * Deck entry hit — start_or_resume resolved to a live view, either directly
 * active or via the miss-path promotion. `source` distinguishes the two so the
 * hit-rate dashboard can separate warm hits from self-heals. Best-effort.
 */
function captureDeckEntryHit(
	accountId: string,
	orientation: MatchOrientation,
	source: "active" | "promoted",
	view: MatchDeckView,
): void {
	captureProductEventBestEffort({
		distinctId: accountId,
		accountId,
		event: "match_deck_hit",
		operation: "capture_match_deck_hit",
		properties: {
			orientation,
			source,
			revision: view.revision,
			remaining: view.progress.remaining,
		},
	});
}

/**
 * Deck entry miss — start_or_resume could not resolve a live view this request.
 * `reason` separates "no snapshot published yet" (genuinely nothing to show)
 * from "built but still empty/racing" (self-heals on the next entry).
 */
function captureDeckEntryMiss(
	accountId: string,
	orientation: MatchOrientation,
	reason: "no_snapshot" | "promotion_incomplete",
): void {
	captureProductEventBestEffort({
		distinctId: accountId,
		accountId,
		event: "match_deck_miss_reason",
		operation: "capture_match_deck_miss_reason",
		properties: { orientation, reason },
	});
}

/** Reverse the frozen preset↔minScore map (mirrors service.ts:152-154). */
function presetForMinScore(minScore: number): string {
	return (
		Object.entries(STRICTNESS_MIN_SCORE).find(([, v]) => v === minScore)?.[0] ??
		DEFAULT_MATCH_STRICTNESS
	);
}

/**
 * The suggestion window baked into the deck view's current/next cards. Playlist
 * decks are first-page-fast (tail pages via the suggestions infinite query);
 * song decks read the whole capped set in one shot (nextCursor always null).
 */
function deckWindow(orientation: MatchOrientation): number {
	return orientation === "playlist"
		? PLAYLIST_CARD_FIRST_PAGE_SIZE
		: SONG_CARD_SUGGESTION_CAP;
}

// ============================================================================
// Mappers (exported for test)
// ============================================================================

/**
 * Maps one read_match_deck_card JSONB payload to the shared MatchReviewItemRead
 * union. The playlist arm reuses the exact readPlaylistCardFromCapture mapping
 * (song suggestion rows → MatchingSongSuggestion, suggestionTotal capped, cursor
 * derived); the song arm mirrors it (playlist suggestion rows → MatchingPlaylistMatch,
 * nextCursor always null per R-D). `not_captured` maps to retryable-error — the
 * readMatchDeckCard server fn recovers it on-demand (R-E) before the map runs.
 *
 * `orientation` sources the no_visible_suggestions copy (legacy parity with
 * readPlaylistCardFromCapture, which must name the suggestion side, not the
 * subject). The read_match_deck_card payload doesn't carry orientation on that
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
	switch (rpc.status) {
		case "ready": {
			if (rpc.song) {
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
					analysis: (song.analysis ?? null) as MatchingSong["analysis"] | null,
				};
				const playlistRows = (rpc.suggestions ??
					[]) as DeckCardPlaylistSuggestionRow[];
				const suggestions: MatchingPlaylistMatch[] = playlistRows.map(
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
						rpc.total_active_count ?? 0,
						SONG_CARD_SUGGESTION_CAP,
					),
					nextCursor: null,
				};
			}
			if (rpc.playlist) {
				const pl = rpc.playlist;
				const reviewItem: MatchingPlaylistForReview = {
					id: pl.id,
					spotifyId: pl.spotify_id,
					name: pl.name,
					description: pl.match_intent,
					imageUrl: pl.image_url,
					trackCount: pl.song_count,
				};
				const songRows = (rpc.suggestions ?? []) as DeckCardSongSuggestionRow[];
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
					rpc.total_active_count ?? 0,
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
			// ready but neither subject present — a shape violation; surface retryable.
			return {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
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
		default:
			// not_captured (cold path after R-E couldn't recover) or any unexpected
			// status — retryable so the client can re-fetch.
			return {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			};
	}
}

function mapCardEnvelope(
	env: DeckCardEnvelope | null,
	pageSize: number,
	orientation: MatchOrientation,
): MatchDeckCard | null {
	if (!env) return null;
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
	rpc: StartOrResumeMatchDeckRpcResult,
	pageSize: number,
): MatchDeckView {
	const orientation: MatchOrientation =
		rpc.orientation === "playlist" ? "playlist" : "song";

	let snapshotId = rpc.snapshotId ?? null;
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

	const progress = rpc.progress ?? {
		total: 0,
		remaining: 0,
		caughtUp: true,
		hiddenReviewItemCount: 0,
	};

	return {
		version: 1,
		accountId: rpc.accountId ?? "",
		orientation,
		sessionId: rpc.sessionId ?? "",
		snapshotId,
		visibilityConfigHash: rpc.visibilityConfigHash ?? "",
		revision: rpc.revision ?? 0,
		progress: {
			total: progress.total,
			remaining: progress.remaining,
			caughtUp: progress.caughtUp,
			hiddenReviewItemCount: progress.hiddenReviewItemCount,
		},
		itemIds: rpc.itemIds ?? [],
		cards: {
			current: mapCardEnvelope(
				rpc.cards?.current ?? null,
				pageSize,
				orientation,
			),
			next: mapCardEnvelope(rpc.cards?.next ?? null, pageSize, orientation),
		},
	};
}

// ============================================================================
// resolveMatchDeckView — shared by startOrResume + submit (read-after-write)
// ============================================================================

/**
 * The one bounded deck read: compute nowMs → hash (from the SAME target filters
 * a proposal build reads) → call the RPC → map, with the miss branches folded in.
 * On a miss with a published snapshot, the approach-X first-window build runs and
 * re-invokes the RPC; with no snapshot at all, the building empty state.
 *
 * One `nowMs` is threaded into the hash AND (on a miss) buildFirstWindowAndPromote
 * so the RPC's branch-2 search key is byte-identical to the built proposal's hash.
 *
 * `skipHashComputation` (M10): submitMatchDeckAction's read-after-write can only
 * land on the RPC's branch 1 (active session — the action already ran in-txn),
 * which never reads p_visibility_config_hash. In that mode, probe the RPC with a
 * null hash first; branch 1 answers regardless (zero hash cost). Only when the
 * probe reports no active session (the promotion/miss branches, which DO need
 * the hash) do we fall back to computing it and re-calling the RPC properly —
 * a branch that can't happen mid-action in practice, so it's a rare fallback,
 * not the common path.
 */
async function resolveMatchDeckView(
	accountId: string,
	orientation: MatchOrientation,
	// Only a genuine deck ENTRY (startOrResumeMatchDeck) emits hit/miss metrics;
	// submitMatchDeckAction reuses this resolver for its read-after-write and must
	// not double-count entries as hits.
	emitEntryMetrics = false,
	options?: { skipHashComputation?: boolean },
): Promise<StartOrResumeMatchDeckResult> {
	const window = deckWindow(orientation);

	if (options?.skipHashComputation) {
		const probeResult = await callStartOrResumeMatchDeck(
			accountId,
			orientation,
			null,
			window,
		);
		if (Result.isError(probeResult)) {
			reportDeckError(probeResult.error, "resolve_match_deck_view", accountId, {
				orientation,
			});
			throw new Error("Could not load your match deck. Please try again.", {
				cause: probeResult.error,
			});
		}
		if (probeResult.value.status === "active") {
			const view = mapStartOrResumeToView(probeResult.value, window);
			if (emitEntryMetrics) {
				captureDeckEntryHit(accountId, orientation, "active", view);
			}
			return view;
		}
		// No active session: a null hash can never satisfy branch 2's exact-match
		// filter, so this is a guaranteed miss regardless of the real hash — fall
		// through to the normal path below, which computes it for real.
	}

	const nowMs = Date.now();
	const hashResult = await resolveVisibilityConfigHash(
		accountId,
		orientation,
		nowMs,
	);
	if (Result.isError(hashResult)) {
		reportDeckError(hashResult.error, "resolve_match_deck_view", accountId, {
			orientation,
		});
		throw new Error("Could not prepare your match deck. Please try again.", {
			cause: hashResult.error,
		});
	}
	const { hash: visibilityConfigHash, minScore } = hashResult.value;
	const preset = presetForMinScore(minScore);

	const rpcResult = await callStartOrResumeMatchDeck(
		accountId,
		orientation,
		visibilityConfigHash,
		window,
	);
	if (Result.isError(rpcResult)) {
		reportDeckError(rpcResult.error, "resolve_match_deck_view", accountId, {
			orientation,
		});
		throw new Error("Could not load your match deck. Please try again.", {
			cause: rpcResult.error,
		});
	}

	if (rpcResult.value.status === "active") {
		const view = mapStartOrResumeToView(rpcResult.value, window);
		if (emitEntryMetrics) {
			captureDeckEntryHit(accountId, orientation, "active", view);
		}
		return view;
	}

	// Miss. Distinguish "no snapshot at all" (building empty state) from
	// "no ready proposal yet" (approach-X first-window build).
	const snapshotResult = await getLatestMatchSnapshot(accountId);
	if (Result.isError(snapshotResult)) {
		reportDeckError(
			snapshotResult.error,
			"resolve_match_deck_view",
			accountId,
			{
				orientation,
			},
		);
		throw new Error("Could not load your match deck. Please try again.", {
			cause: snapshotResult.error,
		});
	}
	if (!snapshotResult.value) {
		if (emitEntryMetrics) {
			captureDeckEntryMiss(accountId, orientation, "no_snapshot");
		}
		return { status: "building" };
	}

	const builtResult = await buildFirstWindowAndPromote({
		accountId,
		orientation,
		snapshotId: snapshotResult.value.id,
		preset,
		minScore,
		visibilityConfigHash,
		nowMs,
		window,
	});
	if (Result.isError(builtResult)) {
		reportDeckError(
			builtResult.error,
			"resolve_match_deck_view_miss",
			accountId,
			{ orientation },
		);
		throw new Error("Could not prepare your match deck. Please try again.", {
			cause: builtResult.error,
		});
	}
	if (builtResult.value.status === "active") {
		const view = mapStartOrResumeToView(builtResult.value, window);
		if (emitEntryMetrics) {
			captureDeckEntryHit(accountId, orientation, "promoted", view);
		}
		return view;
	}
	// Still a miss right after building (empty subject set / hash race) → building.
	// The enqueued full build makes the next entry a hit.
	if (emitEntryMetrics) {
		captureDeckEntryMiss(accountId, orientation, "promotion_incomplete");
	}
	return { status: "building" };
}

// ============================================================================
// readMatchDeckCard — pure read + on-demand materialize fallback (R-E)
// ============================================================================

/**
 * Loads the owning session/orientation/position for a not-captured card and
 * captures just this one item (reusing captureAheadForSession, window 1) so the
 * re-read finds pairs. Best-effort: a capture failure still lets the re-read
 * surface the not_captured fallback rather than throwing.
 */
async function materializeOnDemand(
	accountId: string,
	itemId: string,
): Promise<{ orientation: MatchOrientation } | null> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("match_review_queue_item")
		.select("session_id, orientation, position")
		.eq("id", itemId)
		.eq("account_id", accountId)
		.maybeSingle();
	if (error) {
		reportDeckError(error, "read_match_deck_card_load_item", accountId, {
			itemId,
		});
		return null;
	}
	if (!data) return null;
	const orientation = narrowOrientation(data.orientation);
	if (!orientation) return null;

	const captureResult = await captureAheadForSession({
		accountId,
		sessionId: data.session_id,
		orientation,
		fromPosition: data.position,
		window: 1,
	});
	if (Result.isError(captureResult)) {
		reportDeckError(
			captureResult.error,
			"read_match_deck_card_materialize",
			accountId,
			{ itemId, orientation },
		);
	}
	return { orientation };
}

async function resolveDeckCard(
	accountId: string,
	itemId: string,
): Promise<MatchReviewItemRead> {
	// Orientation is unknown up front (itemId only), so read the whole capped set
	// (both caps are 100) — never truncates either arm; nextCursor stays null.
	const window = SONG_CARD_SUGGESTION_CAP;

	const firstResult = await callReadMatchDeckCard(
		itemId,
		accountId,
		window,
		true,
	);
	if (Result.isError(firstResult)) {
		reportDeckError(firstResult.error, "read_match_deck_card", accountId, {
			itemId,
		});
		return {
			status: "retryable-error",
			itemId,
			message: "Couldn't load this match card. Try again.",
		};
	}

	const first = firstResult.value;
	if (first.status !== "not_captured") {
		// Orientation is only carried on a `ready` payload; on no_visible_suggestions
		// it's absent, so null → orientation-neutral copy (never a mislabel).
		return mapReadDeckCardToItemRead(
			first,
			itemId,
			window,
			narrowOrientation(first.item?.orientation),
		);
	}

	// R-E cold path: worker hasn't captured ahead yet — materialize this one item
	// and re-read ONCE. Still not_captured → the mapper's retryable fallback.
	const materialized = await materializeOnDemand(accountId, itemId);

	let coldResult: MatchReviewItemRead;
	let recovered = false;
	if (!materialized) {
		coldResult = mapReadDeckCardToItemRead(first, itemId, window, null);
	} else {
		const secondResult = await callReadMatchDeckCard(
			itemId,
			accountId,
			window,
			true,
		);
		if (Result.isError(secondResult)) {
			reportDeckError(
				secondResult.error,
				"read_match_deck_card_recapture",
				accountId,
				{ itemId, orientation: materialized.orientation },
			);
			coldResult = {
				status: "retryable-error",
				itemId,
				message: "Couldn't load this match card. Try again.",
			};
		} else {
			recovered = secondResult.value.status !== "not_captured";
			// The re-read may now resolve to no_visible_suggestions; materialize gave
			// us the real orientation, so the copy names the correct suggestion side.
			coldResult = mapReadDeckCardToItemRead(
				secondResult.value,
				itemId,
				window,
				materialized.orientation,
			);
		}
	}

	// The on-demand materialize fired (the swiper outran capture-ahead). `recovered`
	// separates a self-heal from a still-cold read. Best-effort.
	captureProductEventBestEffort({
		distinctId: accountId,
		accountId,
		event: "match_deck_materialize_on_read",
		operation: "capture_match_deck_materialize_on_read",
		properties: {
			itemId,
			recovered,
			orientation: materialized?.orientation ?? null,
		},
	});

	return coldResult;
}

// ============================================================================
// submitMatchDeckAction — read-after-write dispatch (R-A)
// ============================================================================

/**
 * Loads the owned queue item so the suggestion actions can route suggestionId to
 * the orientation-correct column and every action can rebuild the view against
 * the item's orientation. Throws on an operational read failure; returns null for
 * a missing/foreign item.
 */
async function loadOwnedItem(
	accountId: string,
	itemId: string,
): Promise<MatchReviewQueueItemDto | null> {
	const supabase = createAdminSupabaseClient();
	const { data, error } = await supabase
		.from("match_review_queue_item")
		.select("*")
		.eq("id", itemId)
		.eq("account_id", accountId)
		.maybeSingle();
	if (error) {
		reportDeckError(error, "submit_match_deck_action_load_item", accountId, {
			itemId,
		});
		throw new Error("Could not process your action. Please try again.", {
			cause: error,
		});
	}
	return data ? mapItemToDto(data) : null;
}

// ============================================================================
// Server functions
// ============================================================================

const StartMatchDeckSchema = z.object({ orientation: OrientationSchema });

/**
 * The one bounded /match-entry call (plan §8): start or resume the deck for the
 * authed account and return the exact view the route renders, or the building
 * state when no snapshot exists yet.
 */
export const startOrResumeMatchDeck = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => StartMatchDeckSchema.parse(data))
	.handler(async ({ data, context }): Promise<StartOrResumeMatchDeckResult> => {
		return resolveMatchDeckView(
			context.session.accountId,
			data.orientation,
			true,
		);
	});

const ReadMatchDeckCardSchema = z.object({ itemId: z.uuid() });

/**
 * Reads one deck card (plan §7): a pure join over captured pairs, dismissed pairs
 * excluded in SQL, presented_at stamped. A not-yet-captured card is materialized
 * on demand and re-read once (R-E, the cold path).
 */
export const readMatchDeckCard = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.inputValidator((data) => ReadMatchDeckCardSchema.parse(data))
	.handler(async ({ data, context }): Promise<MatchReviewItemRead> => {
		return resolveDeckCard(context.session.accountId, data.itemId);
	});

const SubmitMatchDeckActionSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("add-suggestion"),
		itemId: z.uuid(),
		suggestionId: z.uuid(),
	}),
	z.object({
		type: z.literal("dismiss-suggestion"),
		itemId: z.uuid(),
		suggestionId: z.uuid(),
	}),
	z.object({ type: z.literal("finish-card"), itemId: z.uuid() }),
	z.object({ type: z.literal("dismiss-card"), itemId: z.uuid() }),
]);

/**
 * One deck-aware command boundary (plan §9, R-A). Dispatches to the EXISTING
 * atomic domain wrappers — which already do the decision + deck side effects
 * (revision bump, resume_position advance, capture_ahead job) in one txn and keep
 * RETURNS TEXT — then reads the fresh view. The raw TEXT action status is surfaced
 * (never collapsed to a bool); the view reflects the promoted next card.
 *
 * Orientation is derived from the owned item so the two suggestion actions route
 * suggestionId to the correct column (song subject → playlist suggestion column,
 * and vice versa), mirroring addSongToPlaylistFromQueueItem.
 */
export const submitMatchDeckAction = createServerFn({ method: "POST" })
	.middleware([authMiddleware])
	.inputValidator((data) => SubmitMatchDeckActionSchema.parse(data))
	.handler(async ({ data, context }): Promise<SubmitMatchDeckActionResult> => {
		const accountId = context.session.accountId;
		const action = data;

		const item = await loadOwnedItem(accountId, action.itemId);
		if (!item) {
			// Stale client / foreign item — no orientation to rebuild a view against.
			throw new Error("This review item could not be found.");
		}
		const orientation = item.subject.orientation;
		const isSong = orientation === "song";

		let actionStatus: string;
		switch (action.type) {
			case "add-suggestion": {
				const result = await addQueueItemDecisionAtomically(
					action.itemId,
					accountId,
					isSong ? null : action.suggestionId,
					isSong ? action.suggestionId : null,
				);
				if (Result.isError(result)) {
					reportDeckError(result.error, "submit_match_deck_action", accountId, {
						orientation,
						type: action.type,
					});
					throw new Error("Could not add this suggestion. Please try again.", {
						cause: result.error,
					});
				}
				actionStatus = result.value;
				break;
			}
			case "dismiss-suggestion": {
				const result = await dismissQueueItemSuggestionAtomically(
					action.itemId,
					accountId,
					isSong ? null : action.suggestionId,
					isSong ? action.suggestionId : null,
				);
				if (Result.isError(result)) {
					reportDeckError(result.error, "submit_match_deck_action", accountId, {
						orientation,
						type: action.type,
					});
					throw new Error(
						"Could not dismiss this suggestion. Please try again.",
						{ cause: result.error },
					);
				}
				actionStatus = result.value;
				break;
			}
			case "finish-card": {
				const result = await finishQueueItemAtomically(
					action.itemId,
					accountId,
				);
				if (Result.isError(result)) {
					reportDeckError(result.error, "submit_match_deck_action", accountId, {
						orientation,
						type: action.type,
					});
					throw new Error("Could not finish this card. Please try again.", {
						cause: result.error,
					});
				}
				actionStatus = result.value;
				break;
			}
			case "dismiss-card": {
				const result = await dismissQueueItemAtomically(
					action.itemId,
					accountId,
				);
				if (Result.isError(result)) {
					reportDeckError(result.error, "submit_match_deck_action", accountId, {
						orientation,
						type: action.type,
					});
					throw new Error("Could not dismiss this card. Please try again.", {
						cause: result.error,
					});
				}
				actionStatus = result.value;
				break;
			}
		}

		// Read-after-write: the action already advanced the deck in-txn, so the
		// fresh view reflects the promoted next card / caught-up state. skipHashComputation
		// (M10): this can only land on branch 1 (active session) in practice, which
		// never reads the hash — probe with a null hash first and skip the two-round-trip
		// hash computation whenever that's confirmed.
		const view = await resolveMatchDeckView(accountId, orientation, false, {
			skipHashComputation: true,
		});

		// One event per deck action carrying the deck revision (from the fresh
		// view) and the action type/status. Best-effort — never blocks the action.
		captureProductEventBestEffort({
			distinctId: accountId,
			accountId,
			event: "match_deck_action",
			operation: "capture_match_deck_action",
			properties: {
				orientation,
				action_type: action.type,
				action_status: actionStatus,
				revision: "revision" in view ? view.revision : null,
			},
		});

		return { actionStatus, view };
	});
