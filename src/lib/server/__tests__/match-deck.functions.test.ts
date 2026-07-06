import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ReadMatchDeckCardRpcResult,
	StartOrResumeMatchDeckRpcResult,
} from "@/lib/domains/taste/match-review-queue/deck-read-queries";
import { DatabaseError } from "@/lib/shared/errors/database";

// ---------------------------------------------------------------------------
// Mocks — the deck server fns are wrappers over the deck-read RPCs + the atomic
// domain wrappers + the miss-path builder. Everything DB-bound is mocked; the
// pure helpers (visibility hash, caps, cursor) run for real.
// ---------------------------------------------------------------------------

const mockAuthContext = { session: { accountId: "acct-1" }, account: null };
const mockFrom = vi.fn();
const mockAddBreadcrumb = vi.fn();
const mockCaptureException = vi.fn();
const mockResolveMinMatchScore = vi.fn();
const mockFetchTargetPlaylistFilters = vi.fn();
const mockGetLatestMatchSnapshot = vi.fn();
const mockCallStartOrResumeMatchDeck = vi.fn();
const mockCallReadMatchDeckCard = vi.fn();
const mockCaptureAheadForSession = vi.fn();
const mockBuildFirstWindowAndPromote = vi.fn();
const mockAddQueueItemDecisionAtomically = vi.fn();
const mockDismissQueueItemAtomically = vi.fn();
const mockDismissQueueItemSuggestionAtomically = vi.fn();
const mockFinishQueueItemAtomically = vi.fn();

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: () => builder(),
		handler:
			(
				fn: (args: {
					context: typeof mockAuthContext;
					data: unknown;
				}) => unknown,
			) =>
			(input?: { data?: unknown }) =>
				fn({ context: mockAuthContext, data: input?.data }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@sentry/cloudflare", () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args),
	addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		from: (...a: unknown[]) => mockFrom(...a),
	}),
}));

vi.mock("@/lib/platform/auth/auth.middleware", () => ({ authMiddleware: {} }));

vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	resolveMinMatchScore: (...a: unknown[]) => mockResolveMinMatchScore(...a),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: (...a: unknown[]) => mockGetLatestMatchSnapshot(...a),
}));

vi.mock("@/lib/domains/taste/match-review-queue/deck-read-queries", () => ({
	callStartOrResumeMatchDeck: (...a: unknown[]) =>
		mockCallStartOrResumeMatchDeck(...a),
	callReadMatchDeckCard: (...a: unknown[]) => mockCallReadMatchDeckCard(...a),
}));

vi.mock("@/lib/domains/taste/match-review-queue/card-materializer", () => ({
	captureAheadForSession: (...a: unknown[]) => mockCaptureAheadForSession(...a),
}));

vi.mock("../match-deck-miss-path", () => ({
	buildFirstWindowAndPromote: (...a: unknown[]) =>
		mockBuildFirstWindowAndPromote(...a),
}));

vi.mock("@/lib/domains/taste/match-review-queue/queries", () => ({
	fetchTargetPlaylistFilters: (...a: unknown[]) =>
		mockFetchTargetPlaylistFilters(...a),
	addQueueItemDecisionAtomically: (...a: unknown[]) =>
		mockAddQueueItemDecisionAtomically(...a),
	dismissQueueItemAtomically: (...a: unknown[]) =>
		mockDismissQueueItemAtomically(...a),
	dismissQueueItemSuggestionAtomically: (...a: unknown[]) =>
		mockDismissQueueItemSuggestionAtomically(...a),
	finishQueueItemAtomically: (...a: unknown[]) =>
		mockFinishQueueItemAtomically(...a),
	// Pure row→DTO mapper, inlined so loadOwnedItem resolves orientation without DB.
	mapItemToDto: (data: Record<string, unknown>) => ({
		id: data.id,
		sessionId: data.session_id,
		accountId: data.account_id,
		subject:
			data.orientation === "song"
				? { orientation: "song" as const, songId: data.song_id }
				: { orientation: "playlist" as const, playlistId: data.playlist_id },
		sourceSnapshotId: data.source_snapshot_id,
		position: data.position,
		state: data.state,
		resolution: data.resolution,
		sourceScore: data.source_fit_score,
		wasNewAtEnqueue: data.was_new_at_enqueue,
		presentedAt: data.presented_at,
		resolvedAt: data.resolved_at,
		visiblePairsCapturedAt: data.visible_pairs_captured_at ?? null,
		createdAt: data.created_at,
		updatedAt: data.updated_at,
	}),
}));

import {
	mapReadDeckCardToItemRead,
	mapStartOrResumeToView,
	readMatchDeckCard,
	startOrResumeMatchDeck,
	submitMatchDeckAction,
} from "../match-deck.functions";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function playlistSuggestionRows(n: number) {
	return Array.from({ length: n }, (_, i) => ({
		song_id: `song-${i + 1}`,
		name: `S${i + 1}`,
		artists: [`Artist ${i + 1}`],
		album_name: null,
		image_url: null,
		spotify_id: `sp-${i + 1}`,
		genres: [],
		fit_score: 0.9 - i * 0.01,
		visible_rank: i + 1,
		model_rank: i + 1,
	}));
}

function playlistReadyRpc(suggestionCount: number, total: number) {
	return {
		status: "ready" as const,
		item: {
			id: "item-1",
			session_id: "s1",
			orientation: "playlist",
			playlist_id: "pl-1",
			state: "active",
			visible_pairs_captured_at: "t",
		},
		playlist: {
			id: "pl-1",
			spotify_id: "sp-pl-1",
			name: "My Playlist",
			match_intent: "chill",
			image_url: "img",
			song_count: 10,
		},
		suggestions: playlistSuggestionRows(suggestionCount),
		total_active_count: total,
	};
}

const SONG_READY_RPC = {
	status: "ready" as const,
	item: {
		id: "item-1",
		session_id: "s1",
		orientation: "song",
		song_id: "song-1",
		state: "active",
		visible_pairs_captured_at: "t",
	},
	song: {
		id: "song-1",
		spotify_id: "sp-song-1",
		name: "Song One",
		artists: ["The Artist", "Feat"],
		album_name: "The Album",
		image_url: "cover.jpg",
		genres: ["pop"],
		audio_feature: { tempo: 120, energy: 0.7, valence: 0.5 },
		analysis: null,
	},
	suggestions: [
		{
			playlist_id: "pl-1",
			name: "PL 1",
			match_intent: "intent-1",
			image_url: null,
			spotify_id: "sp-pl-1",
			song_count: 5,
			fit_score: 0.8,
			visible_rank: 1,
			model_rank: 1,
		},
		{
			playlist_id: "pl-2",
			name: "PL 2",
			match_intent: null,
			image_url: "pl2.jpg",
			spotify_id: "sp-pl-2",
			song_count: 8,
			fit_score: 0.7,
			visible_rank: 2,
			model_rank: 2,
		},
	],
	total_active_count: 2,
};

function activeStartRpc(
	presentation: ReadMatchDeckCardRpcResult,
): StartOrResumeMatchDeckRpcResult {
	return {
		status: "active" as const,
		version: 1,
		accountId: "acct-1",
		orientation: "playlist",
		sessionId: "s1",
		snapshotId: "snap-1",
		visibilityConfigHash: "vc_playlist_0.5_rtf",
		revision: 3,
		progress: {
			total: 5,
			remaining: 4,
			caughtUp: false,
			hiddenReviewItemCount: 1,
		},
		itemIds: ["item-1", "item-2"],
		cards: {
			current: { itemId: "item-1", position: 0, presentation },
			next: null,
		},
	};
}

const PLAYLIST_ITEM_ROW = {
	id: "item-1",
	session_id: "s1",
	account_id: "acct-1",
	orientation: "playlist",
	song_id: null,
	playlist_id: "pl-1",
	source_snapshot_id: "snap-1",
	position: 0,
	state: "active",
	resolution: null,
	source_fit_score: 0.5,
	was_new_at_enqueue: false,
	presented_at: null,
	resolved_at: null,
	visible_pairs_captured_at: "t",
	created_at: "",
	updated_at: "",
};

const SONG_ITEM_ROW = {
	...PLAYLIST_ITEM_ROW,
	orientation: "song",
	song_id: "song-1",
	playlist_id: null,
};

/** select(...).eq(...).eq(...).maybeSingle() chain for loadOwnedItem / materialize. */
function mockRowRead(row: unknown, error: unknown = null) {
	mockFrom.mockReturnValue({
		select: () => ({
			eq: () => ({
				eq: () => ({
					maybeSingle: () => Promise.resolve({ data: row, error }),
				}),
			}),
		}),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	// Defaults for the shared resolveMatchDeckView path.
	mockResolveMinMatchScore.mockResolvedValue(0.5);
	mockFetchTargetPlaylistFilters.mockResolvedValue(Result.ok(new Map()));
	mockCallStartOrResumeMatchDeck.mockResolvedValue(
		Result.ok(activeStartRpc(playlistReadyRpc(2, 2))),
	);
});

// ---------------------------------------------------------------------------
// mapReadDeckCardToItemRead
// ---------------------------------------------------------------------------

describe("mapReadDeckCardToItemRead", () => {
	it("maps a ready playlist card (subject + song suggestions), caps the total, no tail on a partial page", () => {
		const read = mapReadDeckCardToItemRead(
			playlistReadyRpc(3, 3),
			"item-1",
			8,
			"playlist",
		);
		expect(read.status).toBe("ready");
		if (read.status !== "ready" || read.mode !== "playlist")
			throw new Error("bad");
		expect(read.reviewItem).toEqual({
			id: "pl-1",
			spotifyId: "sp-pl-1",
			name: "My Playlist",
			description: "chill",
			imageUrl: "img",
			trackCount: 10,
		});
		expect(read.suggestions).toHaveLength(3);
		expect(read.suggestions[0].song.artist).toBe("Artist 1");
		expect(read.suggestions[0].fitScore).toBeCloseTo(0.9);
		expect(read.suggestionTotal).toBe(3);
		// 3 rows < pageSize 8 → last page, no cursor.
		expect(read.nextCursor).toBeNull();
	});

	it("caps suggestionTotal at PLAYLIST_CARD_SUGGESTION_CAP and derives a tail cursor on a full page", () => {
		const read = mapReadDeckCardToItemRead(
			playlistReadyRpc(8, 250),
			"item-1",
			8,
			"playlist",
		);
		if (read.status !== "ready" || read.mode !== "playlist")
			throw new Error("bad");
		// total 250 capped to 100.
		expect(read.suggestionTotal).toBe(100);
		// full page (8 === pageSize) and 8 < 100 → cursor from the last row.
		expect(read.nextCursor).toEqual({
			fitScore: read.suggestions[7].fitScore,
			modelRank: 8,
			songId: "song-8",
		});
	});

	it("maps a ready song card (song subject + playlist suggestions), nextCursor always null", () => {
		const read = mapReadDeckCardToItemRead(
			SONG_READY_RPC,
			"item-1",
			100,
			"song",
		);
		if (read.status !== "ready" || read.mode !== "song") throw new Error("bad");
		expect(read.reviewItem.artist).toBe("The Artist");
		expect(read.reviewItem.album).toBe("The Album");
		expect(read.reviewItem.albumArtUrl).toBe("cover.jpg");
		expect(read.reviewItem.audioFeatures).toEqual({
			tempo: 120,
			energy: 0.7,
			valence: 0.5,
		});
		expect(read.suggestions).toHaveLength(2);
		expect(read.suggestions[0].playlist).toEqual({
			id: "pl-1",
			name: "PL 1",
			description: "intent-1",
			trackCount: 5,
			imageUrl: null,
			spotifyId: "sp-pl-1",
		});
		expect(read.suggestions[0].score).toBe(0.8);
		expect(read.suggestions[0].rank).toBe(1);
		expect(read.suggestions[0].factors).toBeNull();
		expect(read.suggestionTotal).toBe(2);
		expect(read.nextCursor).toBeNull();
	});

	it.each([
		["not_found", "unavailable", "not-entitled"],
		["playlist_gone", "unavailable", "not-entitled"],
		["song_gone", "unavailable", "not-entitled"],
		["no_visible_suggestions", "unavailable", "no-visible-suggestions"],
		["not_captured", "retryable-error", undefined],
	])("maps the %s status", (status, expectedStatus, expectedReason) => {
		const read = mapReadDeckCardToItemRead(
			{ status } as never,
			"item-1",
			8,
			"playlist",
		);
		expect(read.status).toBe(expectedStatus);
		if (expectedReason && read.status === "unavailable") {
			expect(read.reason).toBe(expectedReason);
		}
	});

	it("uses orientation-aware no_visible_suggestions copy (legacy parity), generic when unknown", () => {
		// Legacy noVisibleSuggestionsMessage names the SUGGESTION side, not the
		// subject: a playlist card's missing matches are songs, and vice versa.
		const playlist = mapReadDeckCardToItemRead(
			{ status: "no_visible_suggestions" } as never,
			"item-1",
			8,
			"playlist",
		);
		if (playlist.status !== "unavailable") throw new Error("bad");
		expect(playlist.reason).toBe("no-visible-suggestions");
		expect(playlist.message).toBe(
			"No song matches are visible under your current settings.",
		);

		const song = mapReadDeckCardToItemRead(
			{ status: "no_visible_suggestions" } as never,
			"item-1",
			8,
			"song",
		);
		if (song.status !== "unavailable") throw new Error("bad");
		expect(song.message).toBe(
			"No playlist matches are visible under your current settings.",
		);

		// Standalone card GET can't derive orientation on this status → neutral copy.
		const unknown = mapReadDeckCardToItemRead(
			{ status: "no_visible_suggestions" } as never,
			"item-1",
			8,
			null,
		);
		if (unknown.status !== "unavailable") throw new Error("bad");
		expect(unknown.message).toBe(
			"No matches are visible under your current settings.",
		);
	});
});

// ---------------------------------------------------------------------------
// mapStartOrResumeToView — R-F snapshotId null coercion
// ---------------------------------------------------------------------------

describe("mapStartOrResumeToView", () => {
	it("maps an active view (progress, itemIds, current/next cards)", () => {
		const view = mapStartOrResumeToView(
			activeStartRpc(playlistReadyRpc(2, 2)),
			8,
		);
		expect(view.version).toBe(1);
		expect(view.orientation).toBe("playlist");
		expect(view.revision).toBe(3);
		expect(view.progress).toEqual({
			total: 5,
			remaining: 4,
			caughtUp: false,
			hiddenReviewItemCount: 1,
		});
		expect(view.itemIds).toEqual(["item-1", "item-2"]);
		expect(view.cards.current?.itemId).toBe("item-1");
		expect(view.cards.current?.presentation.status).toBe("ready");
		expect(view.cards.next).toBeNull();
	});

	it("coerces a null snapshotId to '' with a Sentry breadcrumb and never throws (R-F)", () => {
		const rpc = { ...activeStartRpc(playlistReadyRpc(1, 1)), snapshotId: null };
		const view = mapStartOrResumeToView(rpc, 8);
		expect(view.snapshotId).toBe("");
		expect(mockAddBreadcrumb).toHaveBeenCalledTimes(1);
		expect(mockAddBreadcrumb.mock.calls[0][0]).toMatchObject({
			category: "match_deck",
		});
	});
});

// ---------------------------------------------------------------------------
// startOrResumeMatchDeck — active / miss branches
// ---------------------------------------------------------------------------

describe("startOrResumeMatchDeck", () => {
	it("returns the mapped view on an active RPC result", async () => {
		mockCallStartOrResumeMatchDeck.mockResolvedValue(
			Result.ok(activeStartRpc(playlistReadyRpc(2, 2))),
		);
		const result = await startOrResumeMatchDeck({
			data: { orientation: "playlist" },
		});
		expect("status" in result && result.status === "building").toBe(false);
		if ("version" in result) {
			expect(result.version).toBe(1);
			expect(result.orientation).toBe("playlist");
		}
		// The hash is computed in TS then passed to the RPC.
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledWith(
			"acct-1",
			"playlist",
			expect.stringMatching(/^vc_playlist_/),
			8, // playlist deck window = first-page-fast
		);
	});

	it("returns the building state on a miss with no snapshot", async () => {
		mockCallStartOrResumeMatchDeck.mockResolvedValue(
			Result.ok({ status: "miss", reason: "no_ready_proposal" }),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));

		const result = await startOrResumeMatchDeck({
			data: { orientation: "song" },
		});
		expect(result).toEqual({ status: "building" });
		expect(mockBuildFirstWindowAndPromote).not.toHaveBeenCalled();
		// Song deck window = whole capped set.
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledWith(
			"acct-1",
			"song",
			expect.any(String),
			100,
		);
	});

	it("miss + snapshot → builds the first window (approach X) and returns the promoted view", async () => {
		mockCallStartOrResumeMatchDeck.mockResolvedValue(
			Result.ok({ status: "miss", reason: "no_ready_proposal" }),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-9" }));
		mockBuildFirstWindowAndPromote.mockResolvedValue(
			Result.ok(activeStartRpc(playlistReadyRpc(2, 2))),
		);

		const result = await startOrResumeMatchDeck({
			data: { orientation: "playlist" },
		});
		expect("version" in result).toBe(true);
		expect(mockBuildFirstWindowAndPromote).toHaveBeenCalledTimes(1);
		// Same nowMs-derived hash + snapshot threaded into the build.
		expect(mockBuildFirstWindowAndPromote.mock.calls[0][0]).toMatchObject({
			accountId: "acct-1",
			orientation: "playlist",
			snapshotId: "snap-9",
			preset: "balanced",
			minScore: 0.5,
			window: 8,
		});
	});

	it("miss + snapshot but the build still misses → building", async () => {
		mockCallStartOrResumeMatchDeck.mockResolvedValue(
			Result.ok({ status: "miss", reason: "no_ready_proposal" }),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-9" }));
		mockBuildFirstWindowAndPromote.mockResolvedValue(
			Result.ok({ status: "miss", reason: "no_ready_proposal" }),
		);

		const result = await startOrResumeMatchDeck({
			data: { orientation: "song" },
		});
		expect(result).toEqual({ status: "building" });
	});
});

// ---------------------------------------------------------------------------
// readMatchDeckCard — R-E on-demand materialize fallback
// ---------------------------------------------------------------------------

describe("readMatchDeckCard", () => {
	it("returns the mapped card directly when captured (no materialize)", async () => {
		mockCallReadMatchDeckCard.mockResolvedValue(
			Result.ok(playlistReadyRpc(2, 2)),
		);
		const read = await readMatchDeckCard({ data: { itemId: "item-1" } });
		expect(read.status).toBe("ready");
		expect(mockCaptureAheadForSession).not.toHaveBeenCalled();
		expect(mockCallReadMatchDeckCard).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			100,
			true,
		);
	});

	it("materializes on demand (window 1) and re-reads once when not_captured (R-E)", async () => {
		mockCallReadMatchDeckCard
			.mockResolvedValueOnce(Result.ok({ status: "not_captured" }))
			.mockResolvedValueOnce(Result.ok(playlistReadyRpc(2, 2)));
		mockRowRead({ session_id: "s1", orientation: "playlist", position: 4 });
		mockCaptureAheadForSession.mockResolvedValue(Result.ok(undefined));

		const read = await readMatchDeckCard({ data: { itemId: "item-1" } });
		expect(read.status).toBe("ready");
		expect(mockCaptureAheadForSession).toHaveBeenCalledWith({
			accountId: "acct-1",
			sessionId: "s1",
			orientation: "playlist",
			fromPosition: 4,
			window: 1,
		});
		expect(mockCallReadMatchDeckCard).toHaveBeenCalledTimes(2);
	});

	it("surfaces retryable-error when the card stays not_captured after materialize", async () => {
		mockCallReadMatchDeckCard.mockResolvedValue(
			Result.ok({ status: "not_captured" }),
		);
		mockRowRead({ session_id: "s1", orientation: "song", position: 0 });
		mockCaptureAheadForSession.mockResolvedValue(Result.ok(undefined));

		const read = await readMatchDeckCard({ data: { itemId: "item-1" } });
		expect(read.status).toBe("retryable-error");
	});
});

// ---------------------------------------------------------------------------
// submitMatchDeckAction — R-A dispatch table + orientation-aware routing
// ---------------------------------------------------------------------------

describe("submitMatchDeckAction", () => {
	it("add-suggestion on a PLAYLIST item routes suggestionId to the song column, then reads the fresh view", async () => {
		mockRowRead(PLAYLIST_ITEM_ROW);
		mockAddQueueItemDecisionAtomically.mockResolvedValue(Result.ok("added"));

		const result = await submitMatchDeckAction({
			data: {
				type: "add-suggestion",
				itemId: "item-1",
				suggestionId: "sug-song",
			},
		});

		// (itemId, accountId, suggestionSongId, suggestionPlaylistId) — playlist subject → song suggestion.
		expect(mockAddQueueItemDecisionAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			"sug-song",
			null,
		);
		expect(result.actionStatus).toBe("added");
		expect("version" in result.view).toBe(true);
	});

	it("add-suggestion on a SONG item routes suggestionId to the playlist column", async () => {
		mockRowRead(SONG_ITEM_ROW);
		mockAddQueueItemDecisionAtomically.mockResolvedValue(Result.ok("added"));

		await submitMatchDeckAction({
			data: {
				type: "add-suggestion",
				itemId: "item-1",
				suggestionId: "sug-pl",
			},
		});

		expect(mockAddQueueItemDecisionAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			null,
			"sug-pl",
		);
	});

	it("dismiss-suggestion on a SONG item routes to the playlist column", async () => {
		mockRowRead(SONG_ITEM_ROW);
		mockDismissQueueItemSuggestionAtomically.mockResolvedValue(
			Result.ok("dismissed"),
		);

		const result = await submitMatchDeckAction({
			data: {
				type: "dismiss-suggestion",
				itemId: "item-1",
				suggestionId: "sug-pl",
			},
		});

		expect(mockDismissQueueItemSuggestionAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			null,
			"sug-pl",
		);
		expect(result.actionStatus).toBe("dismissed");
	});

	it("finish-card dispatches to finishQueueItemAtomically and surfaces the raw status", async () => {
		mockRowRead(PLAYLIST_ITEM_ROW);
		mockFinishQueueItemAtomically.mockResolvedValue(
			Result.ok("completed_added"),
		);

		const result = await submitMatchDeckAction({
			data: { type: "finish-card", itemId: "item-1" },
		});

		expect(mockFinishQueueItemAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
		);
		expect(result.actionStatus).toBe("completed_added");
	});

	it("dismiss-card dispatches to dismissQueueItemAtomically", async () => {
		mockRowRead(PLAYLIST_ITEM_ROW);
		mockDismissQueueItemAtomically.mockResolvedValue(Result.ok("dismissed"));

		const result = await submitMatchDeckAction({
			data: { type: "dismiss-card", itemId: "item-1" },
		});

		expect(mockDismissQueueItemAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
		);
		expect(result.actionStatus).toBe("dismissed");
	});

	it("throws when the item is missing (stale client / foreign item)", async () => {
		mockRowRead(null);
		await expect(
			submitMatchDeckAction({
				data: { type: "finish-card", itemId: "item-1" },
			}),
		).rejects.toThrow();
	});

	it("throws (and reports) when the dispatch wrapper errors", async () => {
		mockRowRead(PLAYLIST_ITEM_ROW);
		mockDismissQueueItemAtomically.mockResolvedValue(
			Result.err(new DatabaseError({ code: "x", message: "boom" })),
		);
		await expect(
			submitMatchDeckAction({
				data: { type: "dismiss-card", itemId: "item-1" },
			}),
		).rejects.toThrow();
		expect(mockCaptureException).toHaveBeenCalled();
	});
});
