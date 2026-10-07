import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { activeDeckRpc, deckPlaylistCardRpc } from "@/test/fixtures";

// ---------------------------------------------------------------------------
// Mocks — the deck server fns run the real deck entry over the deck-read RPCs,
// the atomic domain wrappers and the proposal builder. Everything DB-bound is
// mocked; the pure helpers (visibility hash, caps, cursor) run for real.
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
const mockBuildOneProposal = vi.fn();
const mockCaptureProductEvent = vi.fn();
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

vi.mock(
	"@/lib/domains/taste/match-review-queue/deck-read-queries",
	async (importOriginal) => ({
		...(await importOriginal()),
		callStartOrResumeMatchDeck: (...a: unknown[]) =>
			mockCallStartOrResumeMatchDeck(...a),
		callReadMatchDeckCard: (...a: unknown[]) => mockCallReadMatchDeckCard(...a),
	}),
);

vi.mock("@/lib/domains/taste/match-review-queue/card-materializer", () => ({
	captureAheadForSession: (...a: unknown[]) => mockCaptureAheadForSession(...a),
}));

vi.mock("@/lib/domains/taste/match-review-queue/proposal-builder", () => ({
	buildOneProposal: (...a: unknown[]) => mockBuildOneProposal(...a),
}));

vi.mock("@/lib/observability/capture-product-event", () => ({
	captureProductEventBestEffort: (...a: unknown[]) =>
		mockCaptureProductEvent(...a),
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
	readMatchDeckCard,
	startOrResumeMatchDeck,
	submitMatchDeckAction,
} from "../match-deck.functions";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
	// Defaults for the shared resolveMatchDeck path.
	mockResolveMinMatchScore.mockResolvedValue(0.5);
	mockFetchTargetPlaylistFilters.mockResolvedValue(Result.ok(new Map()));
	mockCallStartOrResumeMatchDeck.mockResolvedValue(
		Result.ok(activeDeckRpc(deckPlaylistCardRpc(2, 2))),
	);
});

// ---------------------------------------------------------------------------
// startOrResumeMatchDeck — active / miss branches
// ---------------------------------------------------------------------------

describe("startOrResumeMatchDeck", () => {
	it("returns the mapped view on an active RPC result", async () => {
		mockCallStartOrResumeMatchDeck.mockResolvedValue(
			Result.ok(activeDeckRpc(deckPlaylistCardRpc(2, 2))),
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
		expect(mockBuildOneProposal).not.toHaveBeenCalled();
		// Song deck window = whole capped set.
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledWith(
			"acct-1",
			"song",
			expect.any(String),
			100,
		);
	});

	it("emits one match_deck_hit for an active entry and one match_deck_miss_reason for an entry with no snapshot", async () => {
		await startOrResumeMatchDeck({ data: { orientation: "playlist" } });
		expect(mockCaptureProductEvent).toHaveBeenCalledTimes(1);
		expect(mockCaptureProductEvent.mock.calls[0][0]).toMatchObject({
			event: "match_deck_hit",
			properties: { orientation: "playlist", source: "active" },
		});

		mockCaptureProductEvent.mockClear();
		mockCallStartOrResumeMatchDeck.mockResolvedValue(
			Result.ok({ status: "miss", reason: "no_ready_proposal" }),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));
		await startOrResumeMatchDeck({ data: { orientation: "song" } });
		expect(mockCaptureProductEvent).toHaveBeenCalledTimes(1);
		expect(mockCaptureProductEvent.mock.calls[0][0]).toMatchObject({
			event: "match_deck_miss_reason",
			properties: { orientation: "song", reason: "no_snapshot" },
		});
	});
});

// ---------------------------------------------------------------------------
// readMatchDeckCard — R-E on-demand materialize fallback
// ---------------------------------------------------------------------------

describe("readMatchDeckCard", () => {
	it("returns the mapped card directly when captured (no materialize)", async () => {
		mockCallReadMatchDeckCard.mockResolvedValue(
			Result.ok(deckPlaylistCardRpc(2, 2)),
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
			.mockResolvedValueOnce(Result.ok(deckPlaylistCardRpc(2, 2)));
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

	it("does not count its read-after-write as a deck entry (no hit/miss event)", async () => {
		mockRowRead(PLAYLIST_ITEM_ROW);
		mockDismissQueueItemAtomically.mockResolvedValue(Result.ok("dismissed"));

		await submitMatchDeckAction({
			data: { type: "dismiss-card", itemId: "item-1" },
		});

		const events = mockCaptureProductEvent.mock.calls.map(([e]) => e.event);
		expect(events).toEqual(["match_deck_action"]);
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

	// -------------------------------------------------------------------------
	// M10: read-after-write probes with a null hash first, skipping the
	// resolveMinMatchScore + fetchTargetPlaylistFilters round trips whenever the
	// RPC reports an active session (the only branch a mid-action read can hit).
	// -------------------------------------------------------------------------

	it("read-after-write probes with a null hash and skips the hash trio on an active session (M10)", async () => {
		mockRowRead(PLAYLIST_ITEM_ROW);
		mockDismissQueueItemAtomically.mockResolvedValue(Result.ok("dismissed"));

		await submitMatchDeckAction({
			data: { type: "dismiss-card", itemId: "item-1" },
		});

		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledWith(
			"acct-1",
			"playlist",
			null,
			8,
		);
		expect(mockResolveMinMatchScore).not.toHaveBeenCalled();
		expect(mockFetchTargetPlaylistFilters).not.toHaveBeenCalled();
	});

	it("falls back to computing the real hash when the read-after-write probe reports no active session", async () => {
		mockRowRead(PLAYLIST_ITEM_ROW);
		mockDismissQueueItemAtomically.mockResolvedValue(Result.ok("dismissed"));
		mockCallStartOrResumeMatchDeck
			.mockResolvedValueOnce(
				Result.ok({ status: "miss", reason: "no_ready_proposal" }),
			)
			.mockResolvedValueOnce(
				Result.ok(activeDeckRpc(deckPlaylistCardRpc(2, 2))),
			);

		const result = await submitMatchDeckAction({
			data: { type: "dismiss-card", itemId: "item-1" },
		});

		// The null-hash probe missed, so the fallback computes the real hash (the
		// trio the skip mode otherwise avoids) and re-calls the RPC with it.
		expect(mockResolveMinMatchScore).toHaveBeenCalledTimes(1);
		expect(mockFetchTargetPlaylistFilters).toHaveBeenCalledTimes(1);
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledTimes(2);
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenNthCalledWith(
			2,
			"acct-1",
			"playlist",
			expect.stringMatching(/^vc_playlist_/),
			8,
		);
		expect("version" in result.view).toBe(true);
	});

	it("falls back to computing the real hash when the null-hash probe hits a legacy active session with no visibility hash", async () => {
		mockRowRead(PLAYLIST_ITEM_ROW);
		mockDismissQueueItemAtomically.mockResolvedValue(Result.ok("dismissed"));
		mockCallStartOrResumeMatchDeck
			.mockResolvedValueOnce(
				Result.ok({
					...activeDeckRpc(deckPlaylistCardRpc(2, 2)),
					visibilityConfigHash: undefined,
				}),
			)
			.mockResolvedValueOnce(
				Result.ok(activeDeckRpc(deckPlaylistCardRpc(2, 2))),
			);

		const result = await submitMatchDeckAction({
			data: { type: "dismiss-card", itemId: "item-1" },
		});

		expect(mockResolveMinMatchScore).toHaveBeenCalledTimes(1);
		expect(mockFetchTargetPlaylistFilters).toHaveBeenCalledTimes(1);
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenCalledTimes(2);
		expect(mockCallStartOrResumeMatchDeck).toHaveBeenNthCalledWith(
			2,
			"acct-1",
			"playlist",
			expect.stringMatching(/^vc_playlist_/),
			8,
		);
		expect("version" in result.view).toBe(true);
		if (!("version" in result.view)) throw new Error("expected active view");
		expect(result.view.visibilityConfigHash).toMatch(/^vc_playlist_/);
	});
});
