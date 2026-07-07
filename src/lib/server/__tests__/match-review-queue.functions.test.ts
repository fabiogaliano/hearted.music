import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItemSongSuggestionRow } from "@/lib/domains/taste/match-review-queue/queries";
import { DatabaseError } from "@/lib/shared/errors/database";
import { listMatchReviewItemSuggestions } from "../match-review-queue.functions";

// Mirrors the private PLAYLIST_CARD_TAIL_PAGE_SIZE constant in
// match-review-queue.functions.ts (not exported — page sizes are an internal
// server-side concern).
const PLAYLIST_CARD_TAIL_PAGE_SIZE = 24;

// ---------------------------------------------------------------------------
// Hoisted mocks — all vi.fn() calls must live here so Vitest hoists them
// above the vi.mock factory calls that reference them.
// ---------------------------------------------------------------------------

const {
	mockAuthContext,
	mockRpc,
	mockFrom,
	mockGetMatchResultDetailsForSong,
	mockGetMatchDecisionsForSongs,
	mockGetServedRanksForSong,
	mockUpsertMatchDecision,
	mockUpsertMatchDecisions,
	mockMarkItemResolved,
	mockAddQueueItemDecisionAtomically,
	mockDismissQueueItemAtomically,
	mockDismissQueueItemSuggestionAtomically,
	mockFinishQueueItemAtomically,
	mockFetchActiveSession,
	mockGetLatestMatchSnapshot,
	mockGetOrderedUndecidedSongIds,
	mockComputeVisibleSuggestionList,
	mockCaptureVisiblePairsAtomic,
	mockReadQueueItemSongSuggestions,
	mockCountCapturedVisiblePairs,
	mockCallPresentMatchReviewItemFast,
	mockCaptureException,
	mockCaptureWithWaitUntil,
	mockGetPlaylistById,
} = vi.hoisted(() => {
	// Shared from mock — overridden per-test via mockFrom.mockImplementation
	const mockFrom = vi.fn();

	return {
		mockAuthContext: {
			session: { accountId: "acct-1" },
			account: null,
		},
		mockRpc: vi.fn(),
		mockFrom,
		mockGetMatchResultDetailsForSong: vi.fn(),
		mockGetMatchDecisionsForSongs: vi.fn(),
		mockGetServedRanksForSong: vi.fn(),
		mockUpsertMatchDecision: vi.fn(),
		mockUpsertMatchDecisions: vi.fn(),
		mockMarkItemResolved: vi.fn(),
		mockAddQueueItemDecisionAtomically: vi.fn(),
		mockDismissQueueItemAtomically: vi.fn(),
		mockDismissQueueItemSuggestionAtomically: vi.fn(),
		mockFinishQueueItemAtomically: vi.fn(),
		mockFetchActiveSession: vi.fn(),
		mockGetLatestMatchSnapshot: vi.fn(),
		mockGetOrderedUndecidedSongIds: vi.fn(),
		mockComputeVisibleSuggestionList: vi.fn(),
		mockCaptureVisiblePairsAtomic: vi.fn(),
		mockReadQueueItemSongSuggestions: vi.fn(),
		mockCountCapturedVisiblePairs: vi.fn(),
		mockCallPresentMatchReviewItemFast: vi.fn(),
		mockCaptureException: vi.fn(),
		mockCaptureWithWaitUntil: vi.fn().mockResolvedValue(undefined),
		mockGetPlaylistById: vi.fn(),
	};
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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
}));

vi.mock("@/utils/posthog-server", () => ({
	captureWithWaitUntil: (...args: unknown[]) =>
		mockCaptureWithWaitUntil(...args),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		rpc: mockRpc,
		from: mockFrom,
	}),
}));

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

vi.mock("@/lib/domains/library/playlists/queries", () => ({
	getPlaylistById: (...args: unknown[]) => mockGetPlaylistById(...args),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getMatchResultDetailsForSong: (...args: unknown[]) =>
		mockGetMatchResultDetailsForSong(...args),
	getServedRanksForSong: (...args: unknown[]) =>
		mockGetServedRanksForSong(...args),
	getLatestMatchSnapshot: (...args: unknown[]) =>
		mockGetLatestMatchSnapshot(...args),
}));

vi.mock("@/lib/domains/taste/song-matching/decision-queries", () => ({
	getMatchDecisionsForSongs: (...args: unknown[]) =>
		mockGetMatchDecisionsForSongs(...args),
	upsertMatchDecision: (...args: unknown[]) => mockUpsertMatchDecision(...args),
	upsertMatchDecisions: (...args: unknown[]) =>
		mockUpsertMatchDecisions(...args),
}));

vi.mock(
	"@/lib/domains/taste/match-review-queue/visible-suggestion-list",
	() => ({
		computeVisibleSuggestionList: (...args: unknown[]) =>
			mockComputeVisibleSuggestionList(...args),
	}),
);

vi.mock("@/lib/domains/taste/match-review-queue/capture-visible-pairs", () => ({
	captureVisiblePairsAtomic: (...args: unknown[]) =>
		mockCaptureVisiblePairsAtomic(...args),
}));

vi.mock("@/lib/domains/taste/match-review-queue/service", () => ({
	getQueueSummary: vi.fn(),
	getOrderedUndecidedSongIds: (...args: unknown[]) =>
		mockGetOrderedUndecidedSongIds(...args),
	markItemResolved: (...args: unknown[]) => mockMarkItemResolved(...args),
}));

vi.mock("@/lib/domains/taste/match-review-queue/queries", () => ({
	addQueueItemDecisionAtomically: (...args: unknown[]) =>
		mockAddQueueItemDecisionAtomically(...args),
	callPresentMatchReviewItemFast: (...args: unknown[]) =>
		mockCallPresentMatchReviewItemFast(...args),
	countCapturedVisiblePairs: (...args: unknown[]) =>
		mockCountCapturedVisiblePairs(...args),
	readQueueItemSongSuggestions: (...args: unknown[]) =>
		mockReadQueueItemSongSuggestions(...args),
	dismissQueueItemAtomically: (...args: unknown[]) =>
		mockDismissQueueItemAtomically(...args),
	dismissQueueItemSuggestionAtomically: (...args: unknown[]) =>
		mockDismissQueueItemSuggestionAtomically(...args),
	fetchActiveSession: (...args: unknown[]) => mockFetchActiveSession(...args),
	fetchQueueItems: vi.fn(),
	finishQueueItemAtomically: (...args: unknown[]) =>
		mockFinishQueueItemAtomically(...args),
	// mapItemToDto is a pure row→DTO mapper used inside fetchOwnedQueueItem.
	// Inline implementation keeps the conversion in test context without needing
	// vi.importActual, since the function has no DB dependencies.
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

// ---------------------------------------------------------------------------
// Helpers for building test fixtures
// ---------------------------------------------------------------------------

// Matches the raw DB row shape that Supabase returns (snake_case).
// fetchOwnedQueueItem reads these fields via mapItemToDto which requires
// orientation and source_fit_score (the MSR-06 renamed column).
const BASE_ITEM = {
	id: "item-1",
	session_id: "session-1",
	account_id: "acct-1",
	song_id: "song-1",
	playlist_id: null,
	orientation: "song",
	source_snapshot_id: "snap-1",
	position: 0,
	state: "pending",
	resolution: null,
	source_fit_score: 0.85,
	was_new_at_enqueue: false,
	visible_pairs_captured_at: null as string | null,
	presented_at: null,
	resolved_at: null,
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

function mockItemOwnership(item: Record<string, unknown> | null) {
	mockFrom.mockImplementation((table: string) => {
		if (table === "match_review_queue_item") {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi
								.fn()
								.mockResolvedValue({ data: item, error: null }),
						}),
					}),
				}),
			};
		}
		if (table === "match_review_session") {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { strictness_min_score: 0 },
								error: null,
							}),
						}),
					}),
				}),
			};
		}
		if (table === "match_decision") {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockResolvedValue({
								// default: 0 adds linked to item
								count: 0,
								error: null,
							}),
						}),
					}),
				}),
			};
		}
		if (table === "playlist") {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { id: "pl-1" },
								error: null,
							}),
						}),
					}),
				}),
			};
		}
		return { select: vi.fn() };
	});
}

const BASE_PLAYLIST_ITEM = {
	...BASE_ITEM,
	orientation: "playlist",
	song_id: null,
	playlist_id: "pl-review",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("listMatchReviewItemSuggestions", () => {
	// A single tail-page row, mirroring the read-model RPC's shape.
	const TAIL_ROW: QueueItemSongSuggestionRow = {
		songId: "song-9",
		name: "Tail Song",
		artists: ["Tail Artist"],
		albumName: "Tail Album",
		imageUrl: "tail.jpg",
		spotifyId: "sp-song-9",
		genres: ["indie"],
		fitScore: 0.6,
		visibleRank: 9,
		modelRank: 9,
		totalActiveCount: 20,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockReadQueueItemSongSuggestions.mockResolvedValue(Result.ok([TAIL_ROW]));
	});

	it("returns an empty page for a foreign/missing queue item (ownership miss)", async () => {
		mockItemOwnership(null);

		const result = await listMatchReviewItemSuggestions({
			data: { itemId: "item-foreign", cursor: null },
		});

		expect(result).toEqual({ suggestions: [], nextCursor: null });
		expect(mockReadQueueItemSongSuggestions).not.toHaveBeenCalled();
	});

	it("returns an empty page for a song-orientation item (tail paging is playlist-mode only)", async () => {
		mockItemOwnership(BASE_ITEM);

		const result = await listMatchReviewItemSuggestions({
			data: { itemId: "item-1", cursor: null },
		});

		expect(result).toEqual({ suggestions: [], nextCursor: null });
		expect(mockReadQueueItemSongSuggestions).not.toHaveBeenCalled();
	});

	it("passes the client cursor through to the domain read", async () => {
		mockItemOwnership(BASE_PLAYLIST_ITEM);
		const cursor = { fitScore: 0.7, modelRank: 3, songId: "song-3" };

		await listMatchReviewItemSuggestions({
			data: { itemId: "item-1", cursor },
		});

		expect(mockReadQueueItemSongSuggestions).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			{ limit: PLAYLIST_CARD_TAIL_PAGE_SIZE, after: cursor },
		);
	});

	it("passes after: undefined for a null cursor (first tail page)", async () => {
		mockItemOwnership(BASE_PLAYLIST_ITEM);

		await listMatchReviewItemSuggestions({
			data: { itemId: "item-1", cursor: null },
		});

		expect(mockReadQueueItemSongSuggestions).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			{ limit: PLAYLIST_CARD_TAIL_PAGE_SIZE, after: undefined },
		);
	});

	it("returns nextCursor: null for a short page (fewer rows than the tail page size)", async () => {
		mockItemOwnership(BASE_PLAYLIST_ITEM);

		const result = await listMatchReviewItemSuggestions({
			data: { itemId: "item-1", cursor: null },
		});

		expect(result.suggestions).toHaveLength(1);
		expect(result.nextCursor).toBeNull();
	});

	it("returns a cursor from the last row when a full tail page comes back", async () => {
		mockItemOwnership(BASE_PLAYLIST_ITEM);
		const fullPage = Array.from(
			{ length: PLAYLIST_CARD_TAIL_PAGE_SIZE },
			(_, i) => ({
				...TAIL_ROW,
				songId: `song-tail-${i}`,
				fitScore: 0.6 - i * 0.001,
				modelRank: i + 1,
			}),
		);
		mockReadQueueItemSongSuggestions.mockResolvedValue(Result.ok(fullPage));

		const result = await listMatchReviewItemSuggestions({
			data: { itemId: "item-1", cursor: null },
		});

		const lastRow = fullPage.at(-1);
		expect(result.nextCursor).toEqual({
			fitScore: lastRow?.fitScore,
			modelRank: lastRow?.modelRank,
			songId: lastRow?.songId,
		});
	});

	it("reports and throws a generic retryable failure on a DB error, instead of silently ending pagination", async () => {
		mockItemOwnership(BASE_PLAYLIST_ITEM);
		const rpcError = new DatabaseError({ code: "PGRST301", message: "boom" });
		mockReadQueueItemSongSuggestions.mockResolvedValue(Result.err(rpcError));

		await expect(
			listMatchReviewItemSuggestions({
				data: { itemId: "item-1", cursor: null },
			}),
		).rejects.toThrow();

		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		const [capturedError, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(capturedError).toBe(rpcError);
		expect(ctx).toMatchObject({
			tags: {
				area: "match_review_queue",
				operation: "list_match_review_item_suggestions",
			},
		});
	});

	it("reports and throws when the ownership read itself errors, instead of treating it as a miss", async () => {
		// A transient read failure on the ownership check must NOT collapse to the
		// empty-page "ownership miss" shape — that would look like "no more pages"
		// and truncate the tail forever. It must surface as a retryable error.
		mockFrom.mockImplementation((table: string) => {
			if (table === "match_review_queue_item") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: null,
									error: { code: "PGRST301", message: "ownership boom" },
								}),
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});

		await expect(
			listMatchReviewItemSuggestions({
				data: { itemId: "item-1", cursor: null },
			}),
		).rejects.toThrow();

		expect(mockReadQueueItemSongSuggestions).not.toHaveBeenCalled();
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		const [, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(ctx).toMatchObject({
			tags: {
				area: "match_review_queue",
				operation: "list_match_review_item_suggestions",
			},
		});
	});
});
