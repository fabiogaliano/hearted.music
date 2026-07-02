import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItemSongSuggestionRow } from "@/lib/domains/taste/match-review-queue/queries";
import { fetchQueueItems } from "@/lib/domains/taste/match-review-queue/queries";
import { createOrResumeQueue } from "@/lib/domains/taste/match-review-queue/service";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	addSongToPlaylistFromQueueItem,
	dismissMatchReviewItem,
	dismissMatchReviewItemSuggestion,
	finishMatchReviewItem,
	getMatchReview,
	getMatchReviewItem,
	listMatchReviewItemSuggestions,
	markMatchReviewItemPresented,
	presentMatchReviewItem,
	startOrResumeMatchReview,
	syncActiveMatchReviewSessions,
} from "../match-review-queue.functions";

// Mirrors the private PLAYLIST_CARD_FIRST_PAGE_SIZE / PLAYLIST_CARD_TAIL_PAGE_SIZE
// constants in match-review-queue.functions.ts (not exported — page sizes are an
// internal server-side concern).
const PLAYLIST_CARD_FIRST_PAGE_SIZE = 8;
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
	mockMarkItemPresented,
	mockMarkItemResolved,
	mockAddQueueItemDecisionAtomically,
	mockDismissQueueItemAtomically,
	mockDismissQueueItemSuggestionAtomically,
	mockFinishQueueItemAtomically,
	mockFetchActiveSession,
	mockSyncActiveQueue,
	mockGetLatestMatchSnapshot,
	mockGetOrderedUndecidedSongIds,
	mockComputeVisibleSuggestionList,
	mockCaptureVisiblePairsAtomic,
	mockClearSongNewness,
	mockReadQueueItemSongSuggestions,
	mockCountCapturedVisiblePairs,
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
		mockMarkItemPresented: vi.fn(),
		mockMarkItemResolved: vi.fn(),
		mockAddQueueItemDecisionAtomically: vi.fn(),
		mockDismissQueueItemAtomically: vi.fn(),
		mockDismissQueueItemSuggestionAtomically: vi.fn(),
		mockFinishQueueItemAtomically: vi.fn(),
		mockFetchActiveSession: vi.fn(),
		mockSyncActiveQueue: vi.fn(),
		mockGetLatestMatchSnapshot: vi.fn(),
		mockGetOrderedUndecidedSongIds: vi.fn(),
		mockComputeVisibleSuggestionList: vi.fn(),
		mockCaptureVisiblePairsAtomic: vi.fn(),
		mockClearSongNewness: vi.fn().mockResolvedValue(undefined),
		mockReadQueueItemSongSuggestions: vi.fn(),
		mockCountCapturedVisiblePairs: vi.fn(),
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
	createOrResumeQueue: vi.fn(),
	getQueueSummary: vi.fn(),
	getOrderedUndecidedSongIds: (...args: unknown[]) =>
		mockGetOrderedUndecidedSongIds(...args),
	markItemPresented: (...args: unknown[]) => mockMarkItemPresented(...args),
	markItemResolved: (...args: unknown[]) => mockMarkItemResolved(...args),
	syncActiveQueue: (...args: unknown[]) => mockSyncActiveQueue(...args),
}));

vi.mock("@/lib/domains/taste/match-review-queue/queries", () => ({
	addQueueItemDecisionAtomically: (...args: unknown[]) =>
		mockAddQueueItemDecisionAtomically(...args),
	clearSongNewness: (...args: unknown[]) => mockClearSongNewness(...args),
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

const BASE_SONG_ROW = {
	id: "song-1",
	spotify_id: "sp-1",
	name: "Test Song",
	artists: ["Test Artist"],
	album_name: "Test Album",
	image_url: "img.jpg",
	genres: ["pop"],
};

// Standard visible suggestion list for getMatchReviewItem happy-path tests.
// computeVisibleSuggestionList is mocked, so this drives the ordering/filtering
// output that the server function maps to its MatchReviewItemRead result.
const DEFAULT_VISIBLE_LIST = {
	orientation: "song" as const,
	subject: { orientation: "song" as const, songId: "song-1" },
	suggestions: [
		{
			songId: "song-1",
			playlistId: "pl-1",
			fitScore: 0.9,
			modelRank: 1,
			visibleRank: 1,
		},
	],
};

/**
 * Sets up mockFrom for the getMatchReviewItem ownership + session reads and the
 * subsequent song/audio/analysis/playlist DB fetches. mockComputeVisibleSuggestionList
 * is wired separately per test so callers can control the derivation result.
 *
 * Replaces the old setupFullItemFetch: getMatchReviewItem now delegates
 * entitlement, pair fetch, ranking fetch, and decision exclusion to
 * computeVisibleSuggestionList rather than performing them inline.
 */
function setupGetItemFetch(
	opts: {
		item?: typeof BASE_ITEM | null;
		sessionRow?: { strictness_min_score: number } | null;
		songRow?: typeof BASE_SONG_ROW | null;
		playlistRows?: Array<{
			id: string;
			name: string;
			match_intent: string | null;
			song_count: number | null;
			image_url: string | null;
			spotify_id: string;
		}>;
	} = {},
) {
	const {
		item = BASE_ITEM,
		sessionRow = { strictness_min_score: 0 },
		songRow = BASE_SONG_ROW,
		playlistRows = [
			{
				id: "pl-1",
				name: "Playlist 1",
				match_intent: "intent",
				song_count: 10,
				image_url: "pl.jpg",
				spotify_id: "sp-pl-1",
			},
		],
	} = opts;

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
							maybeSingle: vi
								.fn()
								.mockResolvedValue({ data: sessionRow, error: null }),
						}),
					}),
				}),
			};
		}
		if (table === "song") {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						single: vi.fn().mockResolvedValue({
							data: songRow,
							error: songRow ? null : { message: "not found" },
						}),
					}),
				}),
			};
		}
		if (table === "song_analysis") {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						order: vi.fn().mockReturnValue({
							limit: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { analysis: { headline: "A song" } },
									error: null,
								}),
							}),
						}),
					}),
				}),
			};
		}
		if (table === "song_audio_feature") {
			return {
				select: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						maybeSingle: vi.fn().mockResolvedValue({
							data: { tempo: 120, energy: 0.8, valence: 0.6 },
							error: null,
						}),
					}),
				}),
			};
		}
		if (table === "playlist") {
			return {
				select: vi.fn().mockReturnValue({
					in: vi.fn().mockResolvedValue({ data: playlistRows, error: null }),
				}),
			};
		}
		return { select: vi.fn() };
	});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getMatchReviewItem", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: computeVisibleSuggestionList returns the standard happy-path list.
		// Individual tests override this to exercise error branches.
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: DEFAULT_VISIBLE_LIST,
		});
	});

	it("returns error for a foreign queue item (ownership check)", async () => {
		// The item row is null: the account_id filter excluded it.
		setupGetItemFetch({ item: null });

		const result = await getMatchReviewItem({
			data: { itemId: "item-foreign" },
		});

		expect(result.status).toBe("retryable-error");
		// Must NOT reveal whether the item id exists.
		expect((result as { message: string }).message).not.toContain("foreign");
		// computeVisibleSuggestionList must not be reached after ownership failure.
		expect(mockComputeVisibleSuggestionList).not.toHaveBeenCalled();
	});

	it("returns unavailable 'not-entitled' when computeVisibleSuggestionList reports song-not-entitled", async () => {
		// Entitlement and pair derivation are delegated to computeVisibleSuggestionList.
		// A song-not-entitled result maps to the 'not-entitled' card state.
		setupGetItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "not-entitled",
			reason: "song-not-entitled",
		});

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("not-entitled");
			expect(result.message).toContain("song");
		}
	});

	it("returns unavailable 'not-entitled' when computeVisibleSuggestionList reports playlist-not-owned", async () => {
		setupGetItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "not-entitled",
			reason: "playlist-not-owned",
		});

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("not-entitled");
			expect(result.message).toContain("playlist");
		}
	});

	it("returns retryable-error when computeVisibleSuggestionList returns db-error", async () => {
		setupGetItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "db-error",
			error: new Error("query timeout"),
		});

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("retryable-error");
	});

	it("returns unavailable 'missing-song' when song row does not exist", async () => {
		// computeVisibleSuggestionList succeeds (the song was still entitled at
		// derivation time) but the subsequent song DB fetch finds no row.
		setupGetItemFetch({ songRow: null });

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("missing-song");
		}
	});

	it("returns unavailable 'snapshot-not-owned' when the session row does not belong to the account", async () => {
		// sessionRow null: the account_id filter on the session query excludes it,
		// meaning the item's session_id references a session owned by a different account.
		// Session check happens before computeVisibleSuggestionList so the helper is never called.
		setupGetItemFetch({ sessionRow: null });

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("snapshot-not-owned");
		}
		// Must not proceed to computeVisibleSuggestionList after session verification fails.
		expect(mockComputeVisibleSuggestionList).not.toHaveBeenCalled();
	});

	it("returns unavailable 'no-visible-suggestions' when derivation returns an empty list", async () => {
		// Empty suggestion list from computeVisibleSuggestionList means either
		// strictness filtered all pairs or all pairs are already decided.
		setupGetItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: { ...DEFAULT_VISIBLE_LIST, suggestions: [] },
		});

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("no-visible-suggestions");
		}
	});

	it("returns ready with song and matches for a healthy item", async () => {
		setupGetItemFetch();

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		if (result.status === "ready" && result.mode === "song") {
			expect(result.itemId).toBe("item-1");
			expect(result.reviewItem.id).toBe("song-1");
			expect(result.reviewItem.name).toBe("Test Song");
			expect(result.reviewItem.artist).toBe("Test Artist");
			expect(result.suggestions).toHaveLength(1);
			expect(result.suggestions[0].playlist.id).toBe("pl-1");
			// score = fitScore from the visible suggestion, not legacy score (A5, E7).
			expect(result.suggestions[0].score).toBe(0.9);
		}
	});

	it("passes stored session strictness to computeVisibleSuggestionList (not live re-read)", async () => {
		// The strictness is read from the session row and forwarded to
		// computeVisibleSuggestionList, not re-read from live preferences.
		setupGetItemFetch({ sessionRow: { strictness_min_score: 0.7 } });

		await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(mockComputeVisibleSuggestionList).toHaveBeenCalledWith(
			expect.objectContaining({ id: "item-1", sourceSnapshotId: "snap-1" }),
			0.7,
		);
	});

	it("passes the owned item DTO to computeVisibleSuggestionList, not client-supplied ids", async () => {
		// Security: song_id and source_snapshot_id come from the server-owned queue
		// item row. computeVisibleSuggestionList receives the full DTO so it can
		// use item.subject.songId and item.sourceSnapshotId internally.
		setupGetItemFetch();

		await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(mockComputeVisibleSuggestionList).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceSnapshotId: "snap-1",
				subject: { orientation: "song", songId: "song-1" },
			}),
			expect.any(Number),
		);
	});

	it("preserves compatibility-first order from computeVisibleSuggestionList in the result (MSR-25)", async () => {
		// Suggestions arrive already ordered by fitScore desc. The server function
		// must preserve that ordering rather than re-sorting by model rank.
		setupGetItemFetch({
			playlistRows: [
				{
					id: "pl-ranked-first",
					name: "Ranked First",
					match_intent: null,
					song_count: 5,
					image_url: null,
					spotify_id: "sp-r1",
				},
				{
					id: "pl-ranked-second",
					name: "Ranked Second",
					match_intent: null,
					song_count: 5,
					image_url: null,
					spotify_id: "sp-r2",
				},
			],
		});
		// Compatibility-first ordering puts the higher fitScore suggestion first,
		// even though its model rank is lower.
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: {
				orientation: "song" as const,
				subject: { orientation: "song" as const, songId: "song-1" },
				suggestions: [
					{
						songId: "song-1",
						playlistId: "pl-ranked-second",
						fitScore: 0.9,
						modelRank: 2,
						visibleRank: 1,
					},
					{
						songId: "song-1",
						playlistId: "pl-ranked-first",
						fitScore: 0.7,
						modelRank: 1,
						visibleRank: 2,
					},
				],
			},
		});

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		if (result.status === "ready" && result.mode === "song") {
			// Compatibility-first order is preserved: the higher fitScore stays first.
			expect(result.suggestions[0].playlist.id).toBe("pl-ranked-second");
			expect(result.suggestions[1].playlist.id).toBe("pl-ranked-first");
			// fitScore is used as the match percent (A5, E7), not the ordering score.
			expect(result.suggestions[0].score).toBe(0.9);
			expect(result.suggestions[1].score).toBe(0.7);
		}
	});

	it("uses fitScore (strictnessScore) as the match percent, not legacy ordering score (MSR-25)", async () => {
		// When fused_score is available, fitScore = fused_score (not match_result.score).
		// The server function must forward fitScore from computeVisibleSuggestionList
		// rather than re-reading the legacy score column.
		setupGetItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: {
				...DEFAULT_VISIBLE_LIST,
				suggestions: [
					{
						songId: "song-1",
						playlistId: "pl-1",
						fitScore: 0.82, // fused_score-based quality signal
						modelRank: 1,
						visibleRank: 1,
					},
				],
			},
		});

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		if (result.status === "ready" && result.mode === "song") {
			expect(result.suggestions[0].score).toBe(0.82);
		}
	});

	it("returns unavailable for playlist-orientation items (warming limitation — MSR-39)", async () => {
		// getMatchReviewItem is song-mode-only for the non-authoritative warming path.
		// Playlist items return unavailable so the warming prefetch does not crash the
		// card stack; the authoritative presentMatchReviewItem handles playlist mode.
		// mockItemOwnership is used rather than setupGetItemFetch because the orientation
		// guard fires before the session row read, so we only need the ownership fetch.
		mockItemOwnership(BASE_PLAYLIST_ITEM);

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		// computeVisibleSuggestionList must not be called — guard fires first.
		expect(mockComputeVisibleSuggestionList).not.toHaveBeenCalled();
	});
});

describe("markMatchReviewItemPresented", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns success: false for a foreign queue item", async () => {
		// Ownership check returns null → foreign item.
		mockFrom.mockImplementation((table: string) => {
			if (table === "match_review_queue_item") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi
									.fn()
									.mockResolvedValue({ data: null, error: null }),
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});

		const result = await markMatchReviewItemPresented({
			data: { itemId: "item-foreign" },
		});

		expect(result.success).toBe(false);
		expect(mockMarkItemPresented).not.toHaveBeenCalled();
	});

	it("calls markItemPresented with ownership-verified item data", async () => {
		mockFrom.mockImplementation((table: string) => {
			if (table === "match_review_queue_item") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi
									.fn()
									.mockResolvedValue({ data: BASE_ITEM, error: null }),
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});

		// markItemPresented returns a camelCase MatchReviewQueueItem (domain type).
		mockMarkItemPresented.mockResolvedValue(
			Result.ok({
				id: "item-1",
				sessionId: "session-1",
				accountId: "acct-1",
				songId: "song-1",
				sourceSnapshotId: "snap-1",
				position: 0,
				state: "presented",
				resolution: null,
				sourceScore: 0.85,
				wasNewAtEnqueue: false,
				presentedAt: "2026-01-01T00:00:00Z",
				resolvedAt: null,
				createdAt: "2026-01-01T00:00:00Z",
				updatedAt: "2026-01-01T00:00:00Z",
			}),
		);

		const result = await markMatchReviewItemPresented({
			data: { itemId: "item-1" },
		});

		expect(result.success).toBe(true);
		expect(result.state).toBe("presented");
		// Called with the server-read songId, not client-supplied data.
		expect(mockMarkItemPresented).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			"song-1",
		);
	});

	it("returns success: false when markItemPresented errors", async () => {
		mockFrom.mockImplementation((table: string) => {
			if (table === "match_review_queue_item") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi
									.fn()
									.mockResolvedValue({ data: BASE_ITEM, error: null }),
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});

		const markError = new Error("db failure");
		mockMarkItemPresented.mockResolvedValue(Result.err(markError));

		const result = await markMatchReviewItemPresented({
			data: { itemId: "item-1" },
		});

		expect(result.success).toBe(false);
		// The operational DB failure is captured before swallowing — this is not
		// the no-eligible-row race (that is the ok(null) branch below).
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		const [capturedError, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(capturedError).toBe(markError);
		expect(ctx).toMatchObject({
			tags: { area: "match_review_queue", operation: "mark_item_presented" },
		});
	});

	it("returns success: false without resurrecting a resolved item (no eligible row)", async () => {
		// Ownership fetch returns an already-resolved item. The conditional update
		// (markItemPresented → updateQueueItemPresented .in(state,…)) matches no
		// eligible row and resolves to ok(null): a resolved card must never be
		// flipped back to "active". State value is 'resolved' (B9-C lifecycle split).
		mockFrom.mockImplementation((table: string) => {
			if (table === "match_review_queue_item") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: { ...BASE_ITEM, state: "resolved" },
									error: null,
								}),
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});

		mockMarkItemPresented.mockResolvedValue(Result.ok(null));

		const result = await markMatchReviewItemPresented({
			data: { itemId: "item-1" },
		});

		expect(result.success).toBe(false);
		// Reports the item's actual current state using the B9-C lifecycle values.
		expect(result.state).toBe("resolved");
	});
});

// ---------------------------------------------------------------------------
// Helpers for Phase 4 mutation tests
// ---------------------------------------------------------------------------

/**
 * Wires the match_review_queue_item ownership fetch. Returns null to simulate
 * a foreign/missing item, or the given item row for an owned item.
 */
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

// ---------------------------------------------------------------------------
// addSongToPlaylistFromQueueItem tests
// ---------------------------------------------------------------------------

const BASE_PLAYLIST_ITEM = {
	...BASE_ITEM,
	orientation: "playlist",
	song_id: null,
	playlist_id: "pl-review",
};

describe("addSongToPlaylistFromQueueItem", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAddQueueItemDecisionAtomically.mockResolvedValue(Result.ok("added"));
	});

	it("rejects a foreign queue item (not-found)", async () => {
		mockItemOwnership(null);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-foreign", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("not-found");
		expect(mockAddQueueItemDecisionAtomically).not.toHaveBeenCalled();
	});

	it("maps atomic foreign playlist rejection", async () => {
		mockItemOwnership(BASE_ITEM);
		mockAddQueueItemDecisionAtomically.mockResolvedValue(
			Result.ok("foreign_playlist"),
		);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "pl-foreign" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("foreign-playlist");
	});

	it("rejects when queue item is already resolved (already-resolved)", async () => {
		mockItemOwnership({ ...BASE_ITEM, state: "resolved" });

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
		expect(mockAddQueueItemDecisionAtomically).not.toHaveBeenCalled();
	});

	it("captures the DB error before returning the opaque add failure", async () => {
		mockItemOwnership(BASE_ITEM);
		const rpcError = new Error("atomic add failed");
		mockAddQueueItemDecisionAtomically.mockResolvedValue(Result.err(rpcError));

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		const [capturedError, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(capturedError).toBe(rpcError);
		expect(ctx).toMatchObject({
			tags: {
				area: "match_review_queue",
				operation: "add_queue_item_decision",
			},
		});
	});

	it("passes suggestion playlist id for song mode", async () => {
		mockItemOwnership(BASE_ITEM);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(true);
		expect(mockAddQueueItemDecisionAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			null,
			"pl-1",
		);
		expect(mockUpsertMatchDecision).not.toHaveBeenCalled();
	});

	it("passes suggestion_song_id for playlist orientation", async () => {
		mockItemOwnership(BASE_PLAYLIST_ITEM);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "song-2" },
		});

		expect(result.success).toBe(true);
		expect(mockAddQueueItemDecisionAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			"song-2",
			null,
		);
	});

	it("maps atomic already-resolved rejection from a stale add", async () => {
		mockItemOwnership(BASE_ITEM);
		mockAddQueueItemDecisionAtomically.mockResolvedValue(
			Result.ok("already_resolved"),
		);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
	});

	it("returns not-visible when RPC returns not_visible", async () => {
		mockItemOwnership(BASE_ITEM);
		mockAddQueueItemDecisionAtomically.mockResolvedValue(
			Result.ok("not_visible"),
		);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("not-visible");
	});

	it("returns invalid-target when RPC returns invalid_target", async () => {
		mockItemOwnership(BASE_ITEM);
		mockAddQueueItemDecisionAtomically.mockResolvedValue(
			Result.ok("invalid_target"),
		);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("invalid-target");
	});

	it("multi-add: two adds to different playlists both succeed without resolving the card", async () => {
		mockItemOwnership(BASE_ITEM);

		const add1 = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});
		const add2 = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", suggestionId: "pl-2" },
		});

		expect(add1.success).toBe(true);
		expect(add2.success).toBe(true);
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
		expect(mockAddQueueItemDecisionAtomically).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// dismissMatchReviewItemSuggestion tests
// ---------------------------------------------------------------------------

describe("dismissMatchReviewItemSuggestion", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDismissQueueItemSuggestionAtomically.mockResolvedValue(
			Result.ok("dismissed"),
		);
	});

	it("passes suggestion playlist id for song mode without resolving the card", async () => {
		mockItemOwnership(BASE_ITEM);

		const result = await dismissMatchReviewItemSuggestion({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(true);
		expect(mockDismissQueueItemSuggestionAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			null,
			"pl-1",
		);
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});

	it("passes suggestion_song_id for playlist orientation", async () => {
		mockItemOwnership(BASE_PLAYLIST_ITEM);

		const result = await dismissMatchReviewItemSuggestion({
			data: { itemId: "item-1", suggestionId: "song-2" },
		});

		expect(result.success).toBe(true);
		expect(mockDismissQueueItemSuggestionAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			"song-2",
			null,
		);
	});

	it("does not call the RPC for a resolved item", async () => {
		mockItemOwnership({ ...BASE_ITEM, state: "resolved" });

		const result = await dismissMatchReviewItemSuggestion({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
		expect(mockDismissQueueItemSuggestionAtomically).not.toHaveBeenCalled();
	});

	it("maps added suggestions to already-added", async () => {
		mockItemOwnership(BASE_ITEM);
		mockDismissQueueItemSuggestionAtomically.mockResolvedValue(
			Result.ok("already_added"),
		);

		const result = await dismissMatchReviewItemSuggestion({
			data: { itemId: "item-1", suggestionId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-added");
	});
});

// ---------------------------------------------------------------------------
// dismissMatchReviewItem tests
// ---------------------------------------------------------------------------

describe("dismissMatchReviewItem", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDismissQueueItemAtomically.mockResolvedValue(Result.ok("dismissed"));
	});

	it("rejects a foreign queue item (not-found)", async () => {
		mockItemOwnership(null);

		const result = await dismissMatchReviewItem({
			data: { itemId: "item-foreign" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("not-found");
		expect(mockDismissQueueItemAtomically).not.toHaveBeenCalled();
	});

	it("rejects when queue item is already resolved (already-resolved)", async () => {
		mockItemOwnership({ ...BASE_ITEM, state: "resolved" });

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
		expect(mockDismissQueueItemAtomically).not.toHaveBeenCalled();
	});

	it("returns success for a song-orientation item when the RPC returns dismissed", async () => {
		// Captured pairs are read by the RPC; the server function passes no decisions.
		mockItemOwnership(BASE_ITEM);

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(true);
		expect(mockDismissQueueItemAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
		);
	});

	it("returns success for a playlist-orientation item when the RPC returns dismissed", async () => {
		// Playlist items are now dismissed via the same RPC — orientation is resolved
		// server-side from the item row, not from the caller.
		mockItemOwnership(BASE_PLAYLIST_ITEM);

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(true);
		expect(mockDismissQueueItemAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
		);
	});

	it("returns derive-failed when the RPC returns no_captured_pairs", async () => {
		// no_captured_pairs means presentMatchReviewItem has not yet run.
		// The item must NOT be resolved so the dismiss can be retried.
		mockItemOwnership(BASE_ITEM);
		mockDismissQueueItemAtomically.mockResolvedValue(
			Result.ok("no_captured_pairs"),
		);

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("derive-failed");
	});

	it("returns already-resolved when the atomic dismiss loses the resolve race", async () => {
		mockItemOwnership(BASE_ITEM);
		mockDismissQueueItemAtomically.mockResolvedValue(
			Result.ok("already_resolved"),
		);

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
	});

	it("returns not-found when the RPC returns not_found (raced item deletion)", async () => {
		mockItemOwnership(BASE_ITEM);
		mockDismissQueueItemAtomically.mockResolvedValue(Result.ok("not_found"));

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("not-found");
	});

	it("returns decision-write-failed when the RPC returns a DB error", async () => {
		mockItemOwnership(BASE_ITEM);
		const rpcError = new Error("rpc error");
		mockDismissQueueItemAtomically.mockResolvedValue(Result.err(rpcError));

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("decision-write-failed");
		// The DB failure is captured before the opaque reason is returned.
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		const [capturedError, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(capturedError).toBe(rpcError);
		expect(ctx).toMatchObject({
			tags: { area: "match_review_queue", operation: "dismiss_queue_item" },
		});
	});

	it.todo(
		"added-pair exclusion: pairs with an existing add decision are excluded from dismissed decisions (integration, handled by RPC)",
	);
});

// ---------------------------------------------------------------------------
// finishMatchReviewItem tests
// ---------------------------------------------------------------------------

describe("finishMatchReviewItem", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockFinishQueueItemAtomically.mockResolvedValue(
			Result.ok("completed_added"),
		);
	});

	it("returns not-found from the atomic finish RPC", async () => {
		mockFinishQueueItemAtomically.mockResolvedValue(Result.ok("not_found"));

		const result = await finishMatchReviewItem({
			data: { itemId: "item-foreign" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("not-found");
	});

	it("returns already-resolved from the atomic finish RPC", async () => {
		mockFinishQueueItemAtomically.mockResolvedValue(
			Result.ok("already_resolved"),
		);

		const result = await finishMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
	});

	it("returns derive-failed when finish RPC finds no captured pairs (MSR-28)", async () => {
		// no_captured_pairs means presentMatchReviewItem has not yet run for this
		// item. The item must not be resolved — the caller should retry after
		// presentation so ranks are always sourced from captured pair rows.
		mockFinishQueueItemAtomically.mockResolvedValue(
			Result.ok("no_captured_pairs"),
		);

		const result = await finishMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("derive-failed");
	});

	it("returns completed/added when atomic finish counts linked add decisions", async () => {
		mockFinishQueueItemAtomically.mockResolvedValue(
			Result.ok("completed_added"),
		);

		const result = await finishMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(true);
		expect(result.resolution).toBe("added");
		expect(mockFinishQueueItemAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
		);
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});

	it("returns skipped when atomic finish finds no linked add decisions", async () => {
		mockFinishQueueItemAtomically.mockResolvedValue(Result.ok("skipped"));

		const result = await finishMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(true);
		expect(result.resolution).toBe("skipped");
		expect(mockUpsertMatchDecision).not.toHaveBeenCalled();
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
	});

	it("returns decision-count-failed when atomic finish errors", async () => {
		const finishError = new Error("query timeout");
		mockFinishQueueItemAtomically.mockResolvedValue(Result.err(finishError));

		const result = await finishMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("decision-count-failed");
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
		// finish never loads the item, so capture carries the itemId instead of
		// orientation — but the DB error must still reach Sentry.
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		const [capturedError, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(capturedError).toBe(finishError);
		expect(ctx).toMatchObject({
			tags: { area: "match_review_queue", operation: "finish_queue_item" },
			extra: { itemId: "item-1" },
		});
	});
});

// ---------------------------------------------------------------------------
// syncActiveMatchReviewSessions tests
// ---------------------------------------------------------------------------

describe("syncActiveMatchReviewSessions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls syncActiveQueue for both song and playlist orientations", async () => {
		mockSyncActiveQueue.mockResolvedValue(
			Result.ok({ appendedCount: 2, alreadyApplied: false }),
		);

		await syncActiveMatchReviewSessions();

		expect(mockSyncActiveQueue).toHaveBeenCalledWith(
			"acct-1",
			"song",
			expect.objectContaining({ onVisibleAppend: expect.any(Function) }),
		);
		expect(mockSyncActiveQueue).toHaveBeenCalledWith(
			"acct-1",
			"playlist",
			expect.objectContaining({ onVisibleAppend: expect.any(Function) }),
		);
		expect(mockSyncActiveQueue).toHaveBeenCalledTimes(2);
	});

	it("returns per-orientation appendedCounts from syncActiveQueue results", async () => {
		mockSyncActiveQueue
			.mockResolvedValueOnce(
				Result.ok({ appendedCount: 3, alreadyApplied: false }),
			)
			.mockResolvedValueOnce(
				Result.ok({ appendedCount: 1, alreadyApplied: false }),
			);

		const result = await syncActiveMatchReviewSessions();

		expect(result.results).toHaveLength(2);
		expect(result.results[0]).toEqual({
			orientation: "song",
			appendedCount: 3,
		});
		expect(result.results[1]).toEqual({
			orientation: "playlist",
			appendedCount: 1,
		});
	});

	it("returns appendedCount: 0 for orientations with no active session", async () => {
		// The domain syncActiveQueue returns appendedCount: 0 when no active session exists.
		mockSyncActiveQueue.mockResolvedValue(
			Result.ok({ appendedCount: 0, alreadyApplied: false }),
		);

		const result = await syncActiveMatchReviewSessions();

		expect(result.results.every((r) => r.appendedCount === 0)).toBe(true);
	});

	it("returns appendedCount: 0 for orientations where the domain layer errors", async () => {
		// A DB error from syncActiveQueue must not propagate — the server fn degrades
		// gracefully per orientation so the live-update path can still proceed.
		mockSyncActiveQueue.mockResolvedValue(Result.err(new Error("db failure")));

		const result = await syncActiveMatchReviewSessions();

		expect(result.results.every((r) => r.appendedCount === 0)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Queue entry points — startOrResumeMatchReview + getMatchReview
// ---------------------------------------------------------------------------

// Orientation-aware DTO queue item shape returned by fetchQueueItems.
function fakeDomainItem(overrides: Record<string, unknown> = {}) {
	return {
		id: "item-1",
		sessionId: "session-1",
		accountId: "acct-1",
		subject: { orientation: "song" as const, songId: "song-1" },
		sourceSnapshotId: "snap-1",
		position: 0,
		state: "pending" as const,
		resolution: null,
		sourceScore: 0.85,
		wasNewAtEnqueue: false,
		presentedAt: null,
		resolvedAt: null,
		visiblePairsCapturedAt: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("startOrResumeMatchReview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// The bootstrap now builds the full review payload (P0). Its caught-up path
		// computes the hidden count via getLatestMatchSnapshot; default to no snapshot
		// so caught-up bootstraps report 0 hidden without reaching the ordered-ids
		// helpers. Tests exercising the hidden-count path override this.
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));
	});

	it("returns an empty caught-up payload when there is no snapshot", async () => {
		vi.mocked(createOrResumeQueue).mockResolvedValue(
			Result.ok({ kind: "no_snapshot" }),
		);

		const result = await startOrResumeMatchReview({
			data: { orientation: "song" },
		});

		expect(result).toEqual({
			sessionId: "",
			itemIds: [],
			firstUnresolvedItemId: null,
			total: 0,
			caughtUp: true,
			// The bootstrap carries the queue-list payload it seeds into the review
			// cache; the no-snapshot case seeds the empty caught-up result (P0).
			review: {
				sessionId: "",
				items: [],
				total: 0,
				caughtUp: true,
				hiddenReviewItemCount: 0,
			},
		});
		// No session means the queue is never read.
		expect(fetchQueueItems).not.toHaveBeenCalled();
		// The "intent set, opened /match, nothing yet" funnel drop-off.
		expect(mockCaptureWithWaitUntil).toHaveBeenCalledWith({
			distinctId: "acct-1",
			event: "match_review_opened",
			properties: {
				orientation: "song",
				state: "no_snapshot",
				result_count: 0,
			},
		});
	});

	it("swallows a capture failure, still returns the payload, and reports it", async () => {
		vi.mocked(createOrResumeQueue).mockResolvedValue(
			Result.ok({ kind: "no_snapshot" }),
		);
		const captureError = new Error("posthog unavailable");
		mockCaptureWithWaitUntil.mockRejectedValue(captureError);

		const result = await startOrResumeMatchReview({
			data: { orientation: "song" },
		});

		// The queue was prepared — a best-effort analytics failure must not turn the
		// /match open into a thrown error.
		expect(result).toEqual({
			sessionId: "",
			itemIds: [],
			firstUnresolvedItemId: null,
			total: 0,
			caughtUp: true,
			review: {
				sessionId: "",
				items: [],
				total: 0,
				caughtUp: true,
				hiddenReviewItemCount: 0,
			},
		});
		await vi.waitFor(() =>
			expect(mockCaptureException).toHaveBeenCalledTimes(1),
		);
		const [capturedError, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(capturedError).toBe(captureError);
		expect(ctx).toMatchObject({
			tags: { area: "analytics", operation: "capture_match_review_opened" },
		});
	});

	it("returns ordered item ids and caughtUp=false for an active queue with unresolved items", async () => {
		vi.mocked(createOrResumeQueue).mockResolvedValue(
			Result.ok({
				kind: "created",
				session: { id: "session-1" } as never,
				appendedCount: 2,
			}),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "pending", position: 0 }),
				fakeDomainItem({ id: "item-2", state: "active", position: 1 }),
			]),
		);

		const result = await startOrResumeMatchReview({
			data: { orientation: "song" },
		});

		expect(result.sessionId).toBe("session-1");
		expect(result.itemIds).toEqual(["item-1", "item-2"]);
		// First reviewable item by position — here the head, since both are unresolved.
		expect(result.firstUnresolvedItemId).toBe("item-1");
		expect(result.total).toBe(2);
		expect(result.caughtUp).toBe(false);
		// P0: the bootstrap carries the complete queue-list payload it seeds into the
		// review cache, built from the same items — mapped to the review item shape,
		// and hiddenReviewItemCount stays 0 while items remain unresolved (no snapshot
		// read on the hot path).
		expect(result.review).toEqual({
			sessionId: "session-1",
			items: [
				{
					id: "item-1",
					position: 0,
					state: "pending",
					subject: { orientation: "song", songId: "song-1" },
					sourceSnapshotId: "snap-1",
				},
				{
					id: "item-2",
					position: 1,
					state: "active",
					subject: { orientation: "song", songId: "song-1" },
					sourceSnapshotId: "snap-1",
				},
			],
			total: 2,
			caughtUp: false,
			hiddenReviewItemCount: 0,
		});
		expect(mockGetLatestMatchSnapshot).not.toHaveBeenCalled();
		expect(mockCaptureWithWaitUntil).toHaveBeenCalledWith({
			distinctId: "acct-1",
			event: "match_review_opened",
			properties: { orientation: "song", state: "reviewing", result_count: 2 },
		});
	});

	it("derives caughtUp=true from item states when every item is resolved", async () => {
		vi.mocked(createOrResumeQueue).mockResolvedValue(
			Result.ok({ kind: "resumed", session: { id: "session-1" } as never }),
		);
		// All resolved — caught up must come from the states, never from null song data.
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "resolved", position: 0 }),
				fakeDomainItem({ id: "item-2", state: "resolved", position: 1 }),
			]),
		);

		const result = await startOrResumeMatchReview({
			data: { orientation: "song" },
		});

		expect(result.caughtUp).toBe(true);
		expect(result.total).toBe(2);
		// Nothing reviewable → no card to seed.
		expect(result.firstUnresolvedItemId).toBeNull();
		expect(mockCaptureWithWaitUntil).toHaveBeenCalledWith({
			distinctId: "acct-1",
			event: "match_review_opened",
			properties: { orientation: "song", state: "caught_up", result_count: 2 },
		});
	});

	it("seeds a caught-up review payload with the same hiddenReviewItemCount getMatchReview would report", async () => {
		// P0 parity: a caught-up bootstrap must carry the same hidden count the
		// refetch path (getMatchReview) computes, against the session's frozen
		// strictness bar — so seeding the cache can't disagree with a later refetch.
		vi.mocked(createOrResumeQueue).mockResolvedValue(
			Result.ok({
				kind: "resumed",
				session: {
					id: "session-1",
					orientation: "song",
					strictnessMinScore: 0.7,
				} as never,
			}),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "resolved", position: 0 }),
			]),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue(
			Result.ok({ songIds: [], hiddenReviewItemCount: 4 }),
		);

		const result = await startOrResumeMatchReview({
			data: { orientation: "song" },
		});

		expect(result.caughtUp).toBe(true);
		expect(result.review.caughtUp).toBe(true);
		expect(result.review.hiddenReviewItemCount).toBe(4);
		// Frozen strictness bar is passed, mirroring getMatchReview's caught-up path.
		expect(mockGetOrderedUndecidedSongIds).toHaveBeenCalledWith(
			"snap-1",
			"acct-1",
			0.7,
		);
	});

	it("reports the first reviewable item by position, not the raw head, on a resumed session", async () => {
		// Regression guard for the first-card seed contract: a resumed session whose
		// head item is already resolved must still report the first pending/active item
		// so the route warms the card the stack actually lands on (not itemIds[0]).
		vi.mocked(createOrResumeQueue).mockResolvedValue(
			Result.ok({ kind: "resumed", session: { id: "session-1" } as never }),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "resolved", position: 0 }),
				fakeDomainItem({ id: "item-2", state: "pending", position: 1 }),
			]),
		);

		const result = await startOrResumeMatchReview({
			data: { orientation: "song" },
		});

		// Head (item-1) is resolved; the seed must point at item-2.
		expect(result.itemIds).toEqual(["item-1", "item-2"]);
		expect(result.firstUnresolvedItemId).toBe("item-2");
		expect(result.caughtUp).toBe(false);
	});

	it("throws a user-safe error when the domain queue setup fails", async () => {
		const dbError = new DatabaseError({ code: "08006", message: "db down" });
		vi.mocked(createOrResumeQueue).mockResolvedValue(Result.err(dbError));

		await expect(
			startOrResumeMatchReview({ data: { orientation: "song" } }),
		).rejects.toThrow(/prepare your match review queue/i);

		// The user-facing message is intentionally generic; the underlying DbError
		// (code + tag) must still reach Sentry so the failure is diagnosable.
		// Assert by identity (toBe) rather than deep-equal: DatabaseError is an
		// IterableError, and a structural match would iterate it and panic.
		const [capturedError, capturedContext] =
			mockCaptureException.mock.calls[0] ?? [];
		expect(capturedError).toBe(dbError);
		expect(capturedContext).toMatchObject({
			tags: {
				operation: "create_or_resume_queue",
				db_error: "DatabaseError",
				db_code: "08006",
			},
		});
	});

	it("throws a user-safe error when loading the queue items fails", async () => {
		vi.mocked(createOrResumeQueue).mockResolvedValue(
			Result.ok({
				kind: "created",
				session: { id: "session-1" } as never,
				appendedCount: 0,
			}),
		);
		const dbError = new DatabaseError({ code: "08006", message: "db down" });
		vi.mocked(fetchQueueItems).mockResolvedValue(Result.err(dbError));

		await expect(
			startOrResumeMatchReview({ data: { orientation: "song" } }),
		).rejects.toThrow(/load your match review queue/i);

		const [capturedError, capturedContext] =
			mockCaptureException.mock.calls[0] ?? [];
		expect(capturedError).toBe(dbError);
		expect(capturedContext).toMatchObject({
			tags: { operation: "fetch_queue_items" },
		});
	});
});

describe("getMatchReview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: no snapshot, so the caught-up path reports zero hidden songs
		// without reaching getOrderedUndecidedSongIds. Tests that exercise the
		// hidden-count path override this.
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));
	});

	it("returns an empty caught-up payload when there is no active session", async () => {
		mockFetchActiveSession.mockResolvedValue(Result.ok(null));

		const result = await getMatchReview({ data: { orientation: "song" } });

		expect(result).toEqual({
			sessionId: "",
			items: [],
			total: 0,
			caughtUp: true,
			hiddenReviewItemCount: 0,
		});
		expect(fetchQueueItems).not.toHaveBeenCalled();
	});

	it("forwards hiddenReviewItemCount from the latest snapshot when caught-up", async () => {
		mockFetchActiveSession.mockResolvedValue(
			Result.ok({
				id: "session-1",
				accountId: "acct-1",
				strictnessMinScore: 0.7,
			}),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "resolved", position: 0 }),
			]),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue(
			Result.ok({ songIds: [], hiddenReviewItemCount: 3 }),
		);

		const result = await getMatchReview({ data: { orientation: "song" } });

		expect(result?.caughtUp).toBe(true);
		expect(result?.hiddenReviewItemCount).toBe(3);
		// The session's frozen strictness bar is passed so the caught-up count is
		// computed against the same policy the queue used, not the live preference.
		expect(mockGetOrderedUndecidedSongIds).toHaveBeenCalledWith(
			"snap-1",
			"acct-1",
			0.7,
		);
	});

	it("does not compute hiddenReviewItemCount while unresolved items remain", async () => {
		mockFetchActiveSession.mockResolvedValue(
			Result.ok({ id: "session-1", accountId: "acct-1" }),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "pending", position: 0 }),
			]),
		);

		const result = await getMatchReview({ data: { orientation: "song" } });

		expect(result?.hiddenReviewItemCount).toBe(0);
		expect(mockGetLatestMatchSnapshot).not.toHaveBeenCalled();
	});

	it("maps queue items and reports caughtUp=false while unresolved items remain", async () => {
		mockFetchActiveSession.mockResolvedValue(
			Result.ok({ id: "session-1", accountId: "acct-1" }),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "pending", position: 0 }),
			]),
		);

		const result = await getMatchReview({ data: { orientation: "song" } });

		expect(result?.sessionId).toBe("session-1");
		expect(result?.items).toEqual([
			{
				id: "item-1",
				position: 0,
				state: "pending",
				subject: { orientation: "song", songId: "song-1" },
				sourceSnapshotId: "snap-1",
			},
		]);
		expect(result?.total).toBe(1);
		expect(result?.caughtUp).toBe(false);
	});

	it("derives caughtUp=true from item states, not from song data", async () => {
		mockFetchActiveSession.mockResolvedValue(
			Result.ok({ id: "session-1", accountId: "acct-1" }),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "resolved", position: 0 }),
				fakeDomainItem({ id: "item-2", state: "resolved", position: 1 }),
			]),
		);

		const result = await getMatchReview({ data: { orientation: "song" } });

		expect(result?.caughtUp).toBe(true);
	});

	it("throws a user-safe error when the active session lookup fails", async () => {
		mockFetchActiveSession.mockResolvedValue(Result.err(new Error("db down")));

		await expect(
			getMatchReview({ data: { orientation: "song" } }),
		).rejects.toThrow(/load your match review queue/i);
	});

	it("throws a user-safe error when loading the queue items fails", async () => {
		mockFetchActiveSession.mockResolvedValue(
			Result.ok({ id: "session-1", accountId: "acct-1" }),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "db down" })),
		);

		await expect(
			getMatchReview({ data: { orientation: "song" } }),
		).rejects.toThrow(/load your match review queue/i);
	});
});

// ---------------------------------------------------------------------------
// presentMatchReviewItem tests
// ---------------------------------------------------------------------------

describe("presentMatchReviewItem", () => {
	// Standard visible suggestion list returned by computeVisibleSuggestionList mock
	const MOCK_LIST = {
		orientation: "song" as const,
		subject: { orientation: "song" as const, songId: "song-1" },
		suggestions: [
			{
				songId: "song-1",
				playlistId: "pl-1",
				fitScore: 0.9,
				modelRank: 1,
				visibleRank: 1,
			},
		],
	};

	beforeEach(() => {
		vi.clearAllMocks();
		// Default happy-path mocks
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: MOCK_LIST,
		});
		mockCaptureVisiblePairsAtomic.mockResolvedValue({ status: "captured" });
		mockClearSongNewness.mockResolvedValue(undefined);
	});

	function setupPresentItemFetch(
		opts: {
			item?: typeof BASE_ITEM | null;
			sessionRow?: { strictness_min_score: number } | null;
			songRow?: typeof BASE_SONG_ROW | null;
			dismissedRows?: Array<{ song_id: string; playlist_id: string }>;
			playlistRows?: Array<{
				id: string;
				name: string;
				match_intent: string | null;
				song_count: number | null;
				image_url: string | null;
				spotify_id: string;
			}>;
		} = {},
	) {
		const {
			item = BASE_ITEM,
			sessionRow = { strictness_min_score: 0 },
			songRow = BASE_SONG_ROW,
			dismissedRows = [],
			playlistRows = [
				{
					id: "pl-1",
					name: "Playlist 1",
					match_intent: "intent",
					song_count: 10,
					image_url: "pl.jpg",
					spotify_id: "sp-pl-1",
				},
			],
		} = opts;

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
								maybeSingle: vi
									.fn()
									.mockResolvedValue({ data: sessionRow, error: null }),
							}),
						}),
					}),
				};
			}
			if (table === "song") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							single: vi.fn().mockResolvedValue({
								data: songRow,
								error: songRow ? null : { message: "not found" },
							}),
						}),
					}),
				};
			}
			if (table === "song_audio_feature") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							maybeSingle: vi.fn().mockResolvedValue({
								data: { tempo: 120, energy: 0.8, valence: 0.6 },
								error: null,
							}),
						}),
					}),
				};
			}
			if (table === "song_analysis") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							order: vi.fn().mockReturnValue({
								limit: vi.fn().mockReturnValue({
									maybeSingle: vi.fn().mockResolvedValue({
										data: { analysis: { headline: "A song" } },
										error: null,
									}),
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
								eq: vi.fn().mockReturnValue({
									in: vi.fn().mockResolvedValue({
										data: dismissedRows,
										error: null,
									}),
								}),
							}),
						}),
					}),
				};
			}
			if (table === "playlist") {
				return {
					select: vi.fn().mockReturnValue({
						in: vi.fn().mockResolvedValue({ data: playlistRows, error: null }),
					}),
				};
			}
			return { select: vi.fn() };
		});
	}

	it("returns unavailable for a foreign or missing queue item", async () => {
		setupPresentItemFetch({ item: null });

		const result = await presentMatchReviewItem({
			data: { itemId: "item-foreign" },
		});

		expect(result.status).toBe("unavailable");
		expect(mockComputeVisibleSuggestionList).not.toHaveBeenCalled();
		expect(mockCaptureVisiblePairsAtomic).not.toHaveBeenCalled();
	});

	it("returns unavailable snapshot-not-owned when session row is missing", async () => {
		setupPresentItemFetch({ sessionRow: null });

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("snapshot-not-owned");
		}
		expect(mockComputeVisibleSuggestionList).not.toHaveBeenCalled();
		// Same stuck-card guard as the entitlement-loss path: the owned item still
		// renders a skippable unavailable card, so it must stamp an empty capture
		// for finishMatchReviewItem to resolve it instead of rejecting NULL capture.
		expect(mockCaptureVisiblePairsAtomic).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			[],
		);
	});

	it("returns unavailable not-entitled when computeVisibleSuggestionList says song-not-entitled", async () => {
		setupPresentItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "not-entitled",
			reason: "song-not-entitled",
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("not-entitled");
			expect(result.message).toContain("song");
		}
		// Regression: an entitlement-loss card MUST stamp an empty visible-pairs
		// capture so it can be skipped. finishMatchReviewItem guards on
		// visible_pairs_captured_at (not row count) and rejects a NULL capture as
		// no_captured_pairs; without this empty capture the unavailable card's Skip
		// would loop forever and the item would stay stuck in the active queue.
		expect(mockCaptureVisiblePairsAtomic).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			[],
		);
	});

	it("stamps an empty capture so an entitlement-loss card is skippable (playlist message)", async () => {
		setupPresentItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "not-entitled",
			reason: "playlist-not-entitled",
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("not-entitled");
			expect(result.message).toContain("playlist");
		}
		expect(mockCaptureVisiblePairsAtomic).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			[],
		);
	});

	it("surfaces retryable-error when the entitlement-loss stamping capture fails", async () => {
		// If the empty stamping capture itself errors we must not hand back an
		// unavailable card that can never be skipped (captured_at still NULL) —
		// surface retryable so the user can retry rather than get stuck.
		setupPresentItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "not-entitled",
			reason: "song-not-entitled",
		});
		mockCaptureVisiblePairsAtomic.mockResolvedValue({
			status: "db-error",
			error: new Error("capture failed"),
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("retryable-error");
	});

	it("returns retryable-error when computeVisibleSuggestionList returns db-error", async () => {
		setupPresentItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "db-error",
			error: new Error("db"),
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("retryable-error");
		expect(mockCaptureVisiblePairsAtomic).not.toHaveBeenCalled();
	});

	it("returns unavailable no-visible-suggestions for empty capture", async () => {
		setupPresentItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: { ...MOCK_LIST, suggestions: [] },
		});
		mockCaptureVisiblePairsAtomic.mockResolvedValue({ status: "empty" });

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("no-visible-suggestions");
			// Song-orientation subject → the missing suggestions are playlists (A1).
			expect(result.message).toContain("playlist matches");
		}
	});

	it("returns unavailable already-resolved when capture RPC returns already_resolved", async () => {
		setupPresentItemFetch();
		mockCaptureVisiblePairsAtomic.mockResolvedValue({
			status: "already_resolved",
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("already-resolved");
		}
	});

	it("returns retryable-error when capture RPC returns invalid_input", async () => {
		setupPresentItemFetch();
		mockCaptureVisiblePairsAtomic.mockResolvedValue({
			status: "invalid_input",
			reason: "bad input",
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("retryable-error");
	});

	it("returns ready with mode, reviewItem and suggestions for a healthy first capture", async () => {
		setupPresentItemFetch();

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		if (result.status === "ready" && result.mode === "song") {
			expect(result.mode).toBe("song");
			expect(result.itemId).toBe("item-1");
			expect(result.reviewItem.id).toBe("song-1");
			expect(result.reviewItem.name).toBe("Test Song");
			expect(result.suggestions).toHaveLength(1);
			expect(result.suggestions[0].playlist.id).toBe("pl-1");
			expect(result.suggestions[0].score).toBe(0.9);
		}
	});

	it("hides row-dismissed captured suggestions without resolving the card", async () => {
		setupPresentItemFetch({
			dismissedRows: [{ song_id: "song-1", playlist_id: "pl-1" }],
			playlistRows: [
				{
					id: "pl-1",
					name: "Playlist 1",
					match_intent: "intent",
					song_count: 10,
					image_url: "pl.jpg",
					spotify_id: "sp-pl-1",
				},
				{
					id: "pl-2",
					name: "Playlist 2",
					match_intent: "intent",
					song_count: 10,
					image_url: "pl-2.jpg",
					spotify_id: "sp-pl-2",
				},
			],
		});
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: {
				...MOCK_LIST,
				suggestions: [
					...MOCK_LIST.suggestions,
					{
						songId: "song-1",
						playlistId: "pl-2",
						fitScore: 0.8,
						modelRank: 2,
						visibleRank: 2,
					},
				],
			},
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		if (result.status === "ready" && result.mode === "song") {
			expect(result.suggestions.map((s) => s.playlist.id)).toEqual(["pl-2"]);
		}
	});

	it("clears song newness on song-mode capture", async () => {
		setupPresentItemFetch();

		await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(mockClearSongNewness).toHaveBeenCalledWith(
			"acct-1",
			"song-1",
			expect.any(String),
		);
	});

	it("does not clear newness when capture returns a non-ready result", async () => {
		setupPresentItemFetch();
		mockCaptureVisiblePairsAtomic.mockResolvedValue({
			status: "already_resolved",
		});

		await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(mockClearSongNewness).not.toHaveBeenCalled();
	});

	it("returns ready from already_captured path without re-deriving the suggestion list", async () => {
		setupPresentItemFetch();
		mockCaptureVisiblePairsAtomic.mockResolvedValue({
			status: "already_captured",
			pairs: [
				{
					songId: "song-1",
					playlistId: "pl-1",
					modelRank: 1,
					visibleRank: 1,
					fitScore: 0.88,
				},
			],
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		if (result.status === "ready" && result.mode === "song") {
			// Score comes from the captured pair's fitScore, not re-derived.
			expect(result.suggestions[0].score).toBe(0.88);
		}
		// computeVisibleSuggestionList was still called to get orientation/subject,
		// but the pair data itself comes from the captured rows.
		expect(mockCaptureVisiblePairsAtomic).toHaveBeenCalledTimes(1);
	});

	it("returns unavailable no-visible-suggestions when already_captured returns empty pairs", async () => {
		setupPresentItemFetch();
		mockCaptureVisiblePairsAtomic.mockResolvedValue({
			status: "already_captured",
			pairs: [],
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("no-visible-suggestions");
		}
	});

	it("passes itemId and accountId (not client-supplied) to captureVisiblePairsAtomic", async () => {
		setupPresentItemFetch();

		await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(mockCaptureVisiblePairsAtomic).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			expect.any(Array),
		);
	});

	// ---------------------------------------------------------------------------
	// Playlist-orientation arm (MSR-39)
	// ---------------------------------------------------------------------------

	// Playlist-orientation visible list: subject is a playlist, suggestions are songs.
	const MOCK_PLAYLIST_LIST = {
		orientation: "playlist" as const,
		subject: { orientation: "playlist" as const, playlistId: "pl-review" },
		suggestions: [
			{
				songId: "song-2",
				playlistId: "pl-review",
				fitScore: 0.75,
				modelRank: 1,
				visibleRank: 1,
			},
		],
	};

	// Default read-model row for the playlist arm — mirrors what the
	// read_match_review_item_song_suggestions RPC returns for song-2.
	const BASE_SUGGESTION_ROW: QueueItemSongSuggestionRow = {
		songId: "song-2",
		name: "Suggested Song",
		artists: ["Suggested Artist"],
		albumName: "Suggested Album",
		imageUrl: "sg.jpg",
		spotifyId: "sp-song-2",
		genres: ["rock"],
		fitScore: 0.75,
		visibleRank: 1,
		modelRank: 1,
		totalActiveCount: 1,
	};

	/**
	 * Wires the playlist-orientation presentMatchReviewItem path:
	 *  - ownership (queue item) + session reads via mockFrom, same chain as
	 *    setupPresentItemFetch
	 *  - playlist subject row via getPlaylistById(accountId, playlistId) — the
	 *    account-scoped read doubles as the entitlement check on the captured
	 *    path (readPlaylistCardFromCapture no longer runs a raw `.from("playlist")`
	 *    read)
	 *  - suggestions via the read-model RPC (readQueueItemSongSuggestions), NOT
	 *    table reads: song and match_decision are never queried on this arm, so
	 *    no id list can hit the URL-length limit regardless of capture size.
	 */
	function setupPlaylistPresentItemFetch(
		opts: {
			item?: typeof BASE_PLAYLIST_ITEM | null;
			sessionRow?: { strictness_min_score: number } | null;
			playlistRow?: {
				id: string;
				name: string;
				match_intent: string | null;
				song_count: number | null;
				image_url: string | null;
				spotify_id: string;
			} | null;
			playlistReadError?: boolean;
			suggestionRows?: Array<typeof BASE_SUGGESTION_ROW>;
			suggestionReadError?: boolean;
			capturedPairCount?: number;
		} = {},
	) {
		const {
			item = BASE_PLAYLIST_ITEM,
			sessionRow = { strictness_min_score: 0 },
			playlistRow = {
				id: "pl-review",
				name: "Review Playlist",
				match_intent: "test intent",
				song_count: 20,
				image_url: "pl.jpg",
				spotify_id: "sp-pl-review",
			},
			playlistReadError = false,
			suggestionRows = [BASE_SUGGESTION_ROW],
			suggestionReadError = false,
			capturedPairCount = 1,
		} = opts;

		mockReadQueueItemSongSuggestions.mockResolvedValue(
			suggestionReadError
				? Result.err(new DatabaseError({ code: "PGRST301", message: "boom" }))
				: Result.ok(suggestionRows),
		);
		mockCountCapturedVisiblePairs.mockResolvedValue(
			Result.ok(capturedPairCount),
		);
		mockGetPlaylistById.mockResolvedValue(
			playlistReadError
				? Result.err(new DatabaseError({ code: "PGRST301", message: "boom" }))
				: Result.ok(playlistRow),
		);

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
								maybeSingle: vi
									.fn()
									.mockResolvedValue({ data: sessionRow, error: null }),
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});
	}

	it("returns ready with playlist reviewItem and song suggestions for a playlist-orientation capture", async () => {
		setupPlaylistPresentItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: MOCK_PLAYLIST_LIST,
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		// Suggestions come from the read-model RPC keyed by item + account only —
		// never from id-list table reads. Only the first page is fetched (P3,
		// first-page-fast) — the rest pages in via listMatchReviewItemSuggestions.
		expect(mockReadQueueItemSongSuggestions).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			{ limit: PLAYLIST_CARD_FIRST_PAGE_SIZE },
		);
		// The playlist row comes from the existing getPlaylistById domain query
		// (account-scoped), not a raw `.from("playlist")` read.
		expect(mockGetPlaylistById).toHaveBeenCalledWith("acct-1", "pl-review");
		if (result.status === "ready" && result.mode === "playlist") {
			expect(result.itemId).toBe("item-1");
			expect(result.reviewItem.id).toBe("pl-review");
			expect(result.reviewItem.name).toBe("Review Playlist");
			expect(result.reviewItem.spotifyId).toBe("sp-pl-review");
			expect(result.suggestions).toHaveLength(1);
			expect(result.suggestions[0].song.id).toBe("song-2");
			expect(result.suggestions[0].song.name).toBe("Suggested Song");
			// fitScore = strictnessScore from captured pair — never reranker/ordering (A5, E7).
			expect(result.suggestions[0].fitScore).toBe(0.75);
			// Single row, well under the first page and the (1-row) total — no tail page.
			expect(result.suggestionTotal).toBe(1);
			expect(result.nextCursor).toBeNull();
		}
	});

	it("does not clear song newness on playlist-mode capture", async () => {
		// clearSongNewness is song-mode-only; calling it on a playlist card would
		// reference a null song_id from the item row.
		setupPlaylistPresentItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: MOCK_PLAYLIST_LIST,
		});

		await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(mockClearSongNewness).not.toHaveBeenCalled();
	});

	it("returns unavailable not-entitled when the review playlist row is not owned or missing", async () => {
		setupPlaylistPresentItemFetch({ playlistRow: null });
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: MOCK_PLAYLIST_LIST,
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("not-entitled");
		}
	});

	it("returns retryable-error and reports when the playlist read fails on playlist mode", async () => {
		setupPlaylistPresentItemFetch({ playlistReadError: true });
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: MOCK_PLAYLIST_LIST,
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("retryable-error");
		// The playlist read error must still reach Sentry before the opaque card.
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		const [, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(ctx).toMatchObject({
			tags: {
				area: "match_review_queue",
				operation: "present_match_review_item",
			},
		});
	});

	it("returns retryable-error and reports when the suggestion read RPC fails on playlist mode", async () => {
		setupPlaylistPresentItemFetch({ suggestionReadError: true });
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: MOCK_PLAYLIST_LIST,
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("retryable-error");
		// The RPC error must still reach Sentry before the opaque card.
		expect(mockCaptureException).toHaveBeenCalledTimes(1);
		const [, ctx] = mockCaptureException.mock.calls[0] ?? [];
		expect(ctx).toMatchObject({
			tags: {
				area: "match_review_queue",
				operation: "present_match_review_item",
			},
		});
	});

	it("uses fitScore from the read-model rows in playlist mode (already_captured path)", async () => {
		// The read RPC reads the captured pair rows, so its fitScore — not the
		// fresh derivation's — is what renders.
		setupPlaylistPresentItemFetch({
			suggestionRows: [{ ...BASE_SUGGESTION_ROW, fitScore: 0.63 }],
		});
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: MOCK_PLAYLIST_LIST,
		});
		mockCaptureVisiblePairsAtomic.mockResolvedValue({
			status: "already_captured",
			pairs: [
				{
					songId: "song-2",
					playlistId: "pl-review",
					modelRank: 1,
					visibleRank: 1,
					fitScore: 0.63,
				},
			],
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		if (result.status === "ready" && result.mode === "playlist") {
			expect(result.suggestions[0].fitScore).toBe(0.63);
		}
	});

	it("returns orientation-correct no-visible-suggestions copy for a playlist item (songs, not playlists)", async () => {
		// The UI renders itemData.message verbatim, so a playlist-orientation card
		// with no visible suggestions must name songs — a hard-coded "playlist
		// matches" would mislabel it (A1). The suggestion side here is songs.
		setupPlaylistPresentItemFetch();
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: { ...MOCK_PLAYLIST_LIST, suggestions: [] },
		});
		mockCaptureVisiblePairsAtomic.mockResolvedValue({ status: "empty" });

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("no-visible-suggestions");
			expect(result.message).toContain("song matches");
			expect(result.message).not.toContain("playlist matches");
		}
	});

	function playlistListWithSongSuggestions(songIds: string[]) {
		return {
			orientation: "playlist" as const,
			subject: { orientation: "playlist" as const, playlistId: "pl-review" },
			suggestions: songIds.map((id, i) => ({
				songId: id,
				playlistId: "pl-review",
				fitScore: 0.5,
				modelRank: i + 1,
				visibleRank: i + 1,
			})),
		};
	}

	// Read-model rows for a generated id set, mirroring the RPC's display order.
	function suggestionRowsFor(songIds: string[]): QueueItemSongSuggestionRow[] {
		return songIds.map((id, i) => ({
			songId: id,
			name: `Song ${id}`,
			artists: ["Artist"],
			albumName: null,
			imageUrl: "sg.jpg",
			spotifyId: `sp-${id}`,
			genres: [] as string[],
			fitScore: 0.5,
			visibleRank: i + 1,
			modelRank: i + 1,
			totalActiveCount: songIds.length,
		}));
	}

	// A queue item whose visible pairs were already captured on an earlier
	// present — the trigger for the derivation-skipping fast path.
	const CAPTURED_PLAYLIST_ITEM = {
		...BASE_PLAYLIST_ITEM,
		visible_pairs_captured_at: "2026-07-01T02:12:48Z",
	};

	it("renders only the first page of an oversized legacy capture, capped total + cursor (P3)", async () => {
		// Pre-cap captures reach 845 pairs. The RPC mock returns just the first
		// PLAYLIST_CARD_FIRST_PAGE_SIZE rows (as the real keyset RPC would for a
		// cursorless, limited first-page call) with total_active_count reflecting
		// the full post-dismissal 845. The read model keys by item + account only,
		// so no suggestion id ever enters a query string regardless of capture size
		// (the 414 bug class this read model already fixed) — and first paint now
		// only pays for 8 rows instead of 845.
		const pageSongIds = Array.from(
			{ length: PLAYLIST_CARD_FIRST_PAGE_SIZE },
			(_, i) => `song-${i}`,
		);
		const firstPageRows = suggestionRowsFor(pageSongIds).map((row) => ({
			...row,
			// total_active_count is identical on every row of a page — the RPC's
			// post-dismissal total for the full legacy capture.
			totalActiveCount: 845,
		}));
		setupPlaylistPresentItemFetch({ suggestionRows: firstPageRows });
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: playlistListWithSongSuggestions(pageSongIds),
		});
		mockCaptureVisiblePairsAtomic.mockResolvedValue({
			status: "already_captured",
			pairs: pageSongIds.map((id, i) => ({
				songId: id,
				playlistId: "pl-review",
				fitScore: 0.5,
				visibleRank: i + 1,
			})),
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		expect(mockReadQueueItemSongSuggestions).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			{ limit: PLAYLIST_CARD_FIRST_PAGE_SIZE },
		);
		expect(mockFrom).not.toHaveBeenCalledWith("song");
		expect(mockFrom).not.toHaveBeenCalledWith("match_decision");
		if (result.status === "ready" && result.mode === "playlist") {
			expect(result.suggestions).toHaveLength(PLAYLIST_CARD_FIRST_PAGE_SIZE);
			// Capped to PLAYLIST_CARD_SUGGESTION_CAP (100) — never the raw 845; the
			// "Reject Match(es)" label must stay bounded to what was ever captured (P2).
			expect(result.suggestionTotal).toBe(100);
			const lastRow = firstPageRows.at(-1);
			expect(result.nextCursor).toEqual({
				fitScore: lastRow?.fitScore,
				modelRank: lastRow?.modelRank,
				songId: lastRow?.songId,
			});
		}
	});

	it("skips derivation and capture entirely for an already-captured playlist item", async () => {
		setupPlaylistPresentItemFetch({ item: CAPTURED_PLAYLIST_ITEM });

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		// The fast path renders from the captured authority alone — the heavy
		// visible-list derivation and the capture RPC never run on a revisit.
		expect(mockComputeVisibleSuggestionList).not.toHaveBeenCalled();
		expect(mockCaptureVisiblePairsAtomic).not.toHaveBeenCalled();
		if (result.status === "ready" && result.mode === "playlist") {
			expect(result.suggestions).toHaveLength(1);
			expect(result.reviewItem.id).toBe("pl-review");
		}
	});

	it("returns unavailable not-entitled on the captured fast path when the playlist is gone", async () => {
		// The account-filtered playlist read doubles as the entitlement check the
		// fast path skips (no checkPlaylistOwned runs without derivation).
		setupPlaylistPresentItemFetch({
			item: CAPTURED_PLAYLIST_ITEM,
			playlistRow: null,
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("not-entitled");
		}
	});

	it("returns ready with an empty list when every captured pair was row-dismissed", async () => {
		setupPlaylistPresentItemFetch({
			item: CAPTURED_PLAYLIST_ITEM,
			suggestionRows: [],
			capturedPairCount: 3,
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		if (result.status === "ready" && result.mode === "playlist") {
			expect(result.suggestions).toHaveLength(0);
		}
	});

	it("returns no-visible-suggestions on the fast path when the capture is empty", async () => {
		// An empty capture (stamped for skippability) must not render as a ready
		// card — zero RPC rows with zero captured pairs is the unavailable state.
		setupPlaylistPresentItemFetch({
			item: CAPTURED_PLAYLIST_ITEM,
			suggestionRows: [],
			capturedPairCount: 0,
		});

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("unavailable");
		if (result.status === "unavailable") {
			expect(result.reason).toBe("no-visible-suggestions");
			expect(result.message).toContain("song matches");
		}
	});

	it("caps a fresh playlist capture to the top N suggestions before capture (P2)", async () => {
		// A hub playlist deriving 250 visible song suggestions must capture only the
		// top 100 by visibleRank, so the visible-pair rows the finish/dismiss RPCs read
		// match exactly what the card renders. list.suggestions is visibleRank-ordered.
		const songIds = Array.from({ length: 250 }, (_, i) => `song-${i}`);
		setupPlaylistPresentItemFetch({
			// The read RPC returns exactly what capture wrote — the capped set.
			suggestionRows: suggestionRowsFor(songIds.slice(0, 100)),
		});
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: playlistListWithSongSuggestions(songIds),
		});
		// Fresh capture (default happy-path status "captured").
		mockCaptureVisiblePairsAtomic.mockResolvedValue({ status: "captured" });

		const result = await presentMatchReviewItem({ data: { itemId: "item-1" } });

		// Capture is invoked with only the top 100 pairs — decisions can't touch a
		// suggestion off the bottom of the list.
		const capturedArg = mockCaptureVisiblePairsAtomic.mock.calls[0]?.[2] as
			| unknown[]
			| undefined;
		expect(capturedArg).toHaveLength(100);
		expect(result.status).toBe("ready");
		if (result.status === "ready" && result.mode === "playlist") {
			expect(result.suggestions).toHaveLength(100);
		}
	});
});

// ---------------------------------------------------------------------------
// listMatchReviewItemSuggestions tests
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
