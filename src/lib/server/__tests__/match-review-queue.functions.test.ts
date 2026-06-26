import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchQueueItems } from "@/lib/domains/taste/match-review-queue/queries";
import { createOrResumeQueue } from "@/lib/domains/taste/match-review-queue/service";
import { DatabaseError } from "@/lib/shared/errors/database";
import {
	addSongToPlaylistFromQueueItem,
	dismissMatchReviewItem,
	finishMatchReviewItem,
	getMatchReview,
	getMatchReviewItem,
	markMatchReviewItemPresented,
	presentMatchReviewItem,
	startOrResumeMatchReview,
	syncActiveMatchReviewSessions,
} from "../match-review-queue.functions";

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
	mockFinishQueueItemAtomically,
	mockFetchActiveSession,
	mockSyncActiveQueue,
	mockGetLatestMatchSnapshot,
	mockGetOrderedUndecidedSongIds,
	mockComputeVisibleSuggestionList,
	mockCaptureVisiblePairsAtomic,
	mockClearSongNewness,
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
		mockFinishQueueItemAtomically: vi.fn(),
		mockFetchActiveSession: vi.fn(),
		mockSyncActiveQueue: vi.fn(),
		mockGetLatestMatchSnapshot: vi.fn(),
		mockGetOrderedUndecidedSongIds: vi.fn(),
		mockComputeVisibleSuggestionList: vi.fn(),
		mockCaptureVisiblePairsAtomic: vi.fn(),
		mockClearSongNewness: vi.fn().mockResolvedValue(undefined),
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

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({
		rpc: mockRpc,
		from: mockFrom,
	}),
}));

vi.mock("@/lib/platform/auth/auth.middleware", () => ({
	authMiddleware: {},
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getMatchResultDetailsForSong: (...args: unknown[]) =>
		mockGetMatchResultDetailsForSong(...args),
	getServedRanksForSong: (...args: unknown[]) =>
		mockGetServedRanksForSong(...args),
	getLatestMatchSnapshot: (...args: unknown[]) =>
		mockGetLatestMatchSnapshot(...args),
}));

vi.mock("@/lib/server/matching.functions", () => ({
	getOrderedUndecidedSongIds: (...args: unknown[]) =>
		mockGetOrderedUndecidedSongIds(...args),
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
	markItemPresented: (...args: unknown[]) => mockMarkItemPresented(...args),
	markItemResolved: (...args: unknown[]) => mockMarkItemResolved(...args),
	syncActiveQueue: (...args: unknown[]) => mockSyncActiveQueue(...args),
}));

vi.mock("@/lib/domains/taste/match-review-queue/queries", () => ({
	addQueueItemDecisionAtomically: (...args: unknown[]) =>
		mockAddQueueItemDecisionAtomically(...args),
	clearSongNewness: (...args: unknown[]) => mockClearSongNewness(...args),
	dismissQueueItemAtomically: (...args: unknown[]) =>
		mockDismissQueueItemAtomically(...args),
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
	visible_pairs_captured_at: null,
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
		if (result.status === "ready") {
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

	it("preserves model-rank order from computeVisibleSuggestionList in the result (MSR-25)", async () => {
		// Suggestions arrive ordered by song-orientation model rank. The server
		// function must preserve this ordering rather than re-sorting by score.
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
		// The model gives pl-ranked-first rank 1 and pl-ranked-second rank 2,
		// even though pl-ranked-second has a higher fitScore (legacy ordering
		// would have put it first).
		mockComputeVisibleSuggestionList.mockResolvedValue({
			kind: "ok",
			list: {
				orientation: "song" as const,
				subject: { orientation: "song" as const, songId: "song-1" },
				suggestions: [
					{
						songId: "song-1",
						playlistId: "pl-ranked-first",
						fitScore: 0.7,
						modelRank: 1,
						visibleRank: 1,
					},
					{
						songId: "song-1",
						playlistId: "pl-ranked-second",
						fitScore: 0.9,
						modelRank: 2,
						visibleRank: 2,
					},
				],
			},
		});

		const result = await getMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.status).toBe("ready");
		if (result.status === "ready") {
			// Model rank order is preserved: rank-1 first even though its fitScore is lower.
			expect(result.suggestions[0].playlist.id).toBe("pl-ranked-first");
			expect(result.suggestions[1].playlist.id).toBe("pl-ranked-second");
			// fitScore is used as the match percent (A5, E7), not the ordering score.
			expect(result.suggestions[0].score).toBe(0.7);
			expect(result.suggestions[1].score).toBe(0.9);
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
		if (result.status === "ready") {
			expect(result.suggestions[0].score).toBe(0.82);
		}
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

		mockMarkItemPresented.mockResolvedValue(
			Result.err(new Error("db failure")),
		);

		const result = await markMatchReviewItemPresented({
			data: { itemId: "item-1" },
		});

		expect(result.success).toBe(false);
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
function mockItemOwnership(item: typeof BASE_ITEM | null) {
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

describe("addSongToPlaylistFromQueueItem", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAddQueueItemDecisionAtomically.mockResolvedValue(Result.ok("added"));
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-1", rank: 2 }]),
		);
	});

	it("rejects a foreign queue item (not-found)", async () => {
		mockItemOwnership(null);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-foreign", playlistId: "pl-1" },
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
			data: { itemId: "item-1", playlistId: "pl-foreign" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("foreign-playlist");
	});

	it("rejects when queue item is already resolved (already-resolved)", async () => {
		mockItemOwnership({ ...BASE_ITEM, state: "resolved" });

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", playlistId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
		expect(mockAddQueueItemDecisionAtomically).not.toHaveBeenCalled();
	});

	it("passes served rank to the atomic add RPC", async () => {
		mockItemOwnership(BASE_ITEM);
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-1", rank: 3 }]),
		);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", playlistId: "pl-1" },
		});

		expect(result.success).toBe(true);
		expect(mockAddQueueItemDecisionAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			"pl-1",
			3,
		);
		expect(mockUpsertMatchDecision).not.toHaveBeenCalled();
	});

	it("maps atomic already-resolved rejection from a stale add", async () => {
		mockItemOwnership(BASE_ITEM);
		mockAddQueueItemDecisionAtomically.mockResolvedValue(
			Result.ok("already_resolved"),
		);

		const result = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", playlistId: "pl-1" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
	});

	it("multi-add: two adds to different playlists both succeed without resolving the card", async () => {
		mockItemOwnership(BASE_ITEM);
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([
				{ playlist_id: "pl-1", rank: 1 },
				{ playlist_id: "pl-2", rank: 2 },
			]),
		);

		const add1 = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", playlistId: "pl-1" },
		});
		const add2 = await addSongToPlaylistFromQueueItem({
			data: { itemId: "item-1", playlistId: "pl-2" },
		});

		expect(add1.success).toBe(true);
		expect(add2.success).toBe(true);
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
		expect(mockAddQueueItemDecisionAtomically).toHaveBeenCalledTimes(2);
	});
});

// ---------------------------------------------------------------------------
// dismissMatchReviewItem tests
// ---------------------------------------------------------------------------

describe("dismissMatchReviewItem", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpsertMatchDecisions.mockResolvedValue(Result.ok([]));
		mockMarkItemResolved.mockResolvedValue(
			Result.ok({ ...BASE_ITEM, state: "completed", resolution: "dismissed" }),
		);
		mockDismissQueueItemAtomically.mockResolvedValue(Result.ok("dismissed"));
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));
		mockGetMatchResultDetailsForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-1", score: 0.9, rank: 1, factors: {} }]),
		);
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-1", rank: 1 }]),
		);
	});

	it("rejects a foreign queue item (not-found)", async () => {
		mockItemOwnership(null);

		const result = await dismissMatchReviewItem({
			data: { itemId: "item-foreign" },
		});

		expect(result.success).toBe(false);
		expect(result.reason).toBe("not-found");
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});

	it("rejects when queue item is already resolved (already-resolved)", async () => {
		mockItemOwnership({ ...BASE_ITEM, state: "resolved" });

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
	});

	it("passes server-derived visible undecided matches to the atomic dismiss", async () => {
		// Two match results; one already decided pair excluded.
		mockGetMatchResultDetailsForSong.mockResolvedValue(
			Result.ok([
				{ playlist_id: "pl-1", score: 0.9, rank: 1, factors: {} },
				{ playlist_id: "pl-2", score: 0.7, rank: 2, factors: {} },
			]),
		);
		// pl-2 was already decided so it must be excluded.
		mockGetMatchDecisionsForSongs.mockResolvedValue(
			Result.ok([{ song_id: "song-1", playlist_id: "pl-2" }]),
		);
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([
				{ playlist_id: "pl-1", rank: 1 },
				{ playlist_id: "pl-2", rank: 2 },
			]),
		);

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
			return { select: vi.fn() };
		});

		await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		// Only pl-1 is visible and undecided — pl-2 was already decided.
		expect(mockDismissQueueItemAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			[
				{
					playlistId: "pl-1",
					modelRank: 1,
				},
			],
		);
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});

	it("respects stored session strictness when deriving visible matches", async () => {
		// Strictness bar = 0.8; pl-2 at 0.6 must be excluded.
		mockGetMatchResultDetailsForSong.mockResolvedValue(
			Result.ok([
				{ playlist_id: "pl-1", score: 0.9, rank: 1, factors: {} },
				{ playlist_id: "pl-2", score: 0.6, rank: 2, factors: {} },
			]),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-1", rank: 1 }]),
		);

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
			if (table === "match_review_session") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								// Stored strictness = 0.8
								maybeSingle: vi.fn().mockResolvedValue({
									data: { strictness_min_score: 0.8 },
									error: null,
								}),
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});

		await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		// Only pl-1 (0.9 >= 0.8) is dismissed; pl-2 (0.6 < 0.8) is invisible.
		expect(mockDismissQueueItemAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			[expect.objectContaining({ playlistId: "pl-1" })],
		);
		expect(mockDismissQueueItemAtomically).not.toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			expect.arrayContaining([expect.objectContaining({ playlistId: "pl-2" })]),
		);
	});

	it("returns already-resolved when the atomic dismiss loses the resolve race", async () => {
		mockItemOwnership(BASE_ITEM);
		mockDismissQueueItemAtomically.mockResolvedValue(
			Result.ok("already_resolved"),
		);

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("already-resolved");
		expect(mockDismissQueueItemAtomically).toHaveBeenCalled();
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});

	it("returns success: false and does NOT resolve when derivation fails (derive-failed)", async () => {
		// Simulate getMatchResultDetailsForSong returning an error.
		mockGetMatchResultDetailsForSong.mockResolvedValue(
			Result.err(new Error("db error")),
		);
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
			return { select: vi.fn() };
		});

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		// Must return failure — not success — so the item stays pending and can be retried.
		expect(result.success).toBe(false);
		expect(result.reason).toBe("derive-failed");
		// No decisions written and the item must NOT have been resolved.
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});

	it("returns derive-failed when the session strictness lookup errors", async () => {
		// The session row carries the strictness that was on screen. If the lookup
		// errors we cannot reproduce the visible set, so falling back to 0 would
		// dismiss playlists the user never reviewed. Bail without writing/resolving.
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
			if (table === "match_review_session") {
				return {
					select: vi.fn().mockReturnValue({
						eq: vi.fn().mockReturnValue({
							eq: vi.fn().mockReturnValue({
								maybeSingle: vi.fn().mockResolvedValue({
									data: null,
									error: { message: "db error" },
								}),
							}),
						}),
					}),
				};
			}
			return { select: vi.fn() };
		});

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("derive-failed");
		// Must bail before deriving/writing decisions or resolving the item.
		expect(mockGetMatchResultDetailsForSong).not.toHaveBeenCalled();
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});

	it("returns derive-failed when no session row is found (null strictness)", async () => {
		// A null session row (foreign/missing session) must not degrade to strictness
		// 0 — same hazard as an error: dismissing matches the user never saw.
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
			if (table === "match_review_session") {
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

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("derive-failed");
		expect(mockGetMatchResultDetailsForSong).not.toHaveBeenCalled();
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});

	it("returns success: false when the atomic dismiss write fails (decision-write-failed)", async () => {
		// Visible undecided match exists, so dismissed decisions are derived and
		// handed to the atomic RPC — but the transaction fails.
		mockGetMatchResultDetailsForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-1", score: 0.9, rank: 1, factors: {} }]),
		);
		mockGetMatchDecisionsForSongs.mockResolvedValue(Result.ok([]));
		mockGetServedRanksForSong.mockResolvedValue(
			Result.ok([{ playlist_id: "pl-1", rank: 1 }]),
		);
		mockDismissQueueItemAtomically.mockResolvedValue(
			Result.err(new Error("decision write failed")),
		);

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
			return { select: vi.fn() };
		});

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		// The transaction failed → must report failure so the queue item stays pending
		// and the dismiss can be retried.
		expect(result.success).toBe(false);
		expect(result.reason).toBe("decision-write-failed");
		expect(mockDismissQueueItemAtomically).toHaveBeenCalled();
		expect(mockUpsertMatchDecisions).not.toHaveBeenCalled();
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});

	it("marks item completed/dismissed", async () => {
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
			return { select: vi.fn() };
		});

		const result = await dismissMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(true);
		expect(mockDismissQueueItemAtomically).toHaveBeenCalledWith(
			"item-1",
			"acct-1",
			[
				{
					playlistId: "pl-1",
					modelRank: 1,
				},
			],
		);
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
	});
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
		mockFinishQueueItemAtomically.mockResolvedValue(
			Result.err(new Error("query timeout")),
		);

		const result = await finishMatchReviewItem({ data: { itemId: "item-1" } });

		expect(result.success).toBe(false);
		expect(result.reason).toBe("decision-count-failed");
		expect(mockMarkItemResolved).not.toHaveBeenCalled();
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

		expect(mockSyncActiveQueue).toHaveBeenCalledWith("acct-1", "song");
		expect(mockSyncActiveQueue).toHaveBeenCalledWith("acct-1", "playlist");
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

// Domain (camelCase) queue item shape returned by fetchQueueItems.
function fakeDomainItem(overrides: Record<string, unknown> = {}) {
	return {
		id: "item-1",
		sessionId: "session-1",
		accountId: "acct-1",
		songId: "song-1",
		sourceSnapshotId: "snap-1",
		position: 0,
		state: "pending" as const,
		resolution: null,
		sourceScore: 0.85,
		wasNewAtEnqueue: false,
		presentedAt: null,
		resolvedAt: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

describe("startOrResumeMatchReview", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
			total: 0,
			caughtUp: true,
		});
		// No session means the queue is never read.
		expect(fetchQueueItems).not.toHaveBeenCalled();
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
		expect(result.total).toBe(2);
		expect(result.caughtUp).toBe(false);
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
	});

	it("throws a user-safe error when the domain queue setup fails", async () => {
		vi.mocked(createOrResumeQueue).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "db down" })),
		);

		await expect(
			startOrResumeMatchReview({ data: { orientation: "song" } }),
		).rejects.toThrow(/prepare your match review queue/i);
	});

	it("throws a user-safe error when loading the queue items fails", async () => {
		vi.mocked(createOrResumeQueue).mockResolvedValue(
			Result.ok({
				kind: "created",
				session: { id: "session-1" } as never,
				appendedCount: 0,
			}),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "db down" })),
		);

		await expect(
			startOrResumeMatchReview({ data: { orientation: "song" } }),
		).rejects.toThrow(/load your match review queue/i);
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
			hiddenSongCount: 0,
		});
		expect(fetchQueueItems).not.toHaveBeenCalled();
	});

	it("forwards hiddenSongCount from the latest snapshot when caught-up", async () => {
		mockFetchActiveSession.mockResolvedValue(
			Result.ok({ id: "session-1", accountId: "acct-1" }),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "resolved", position: 0 }),
			]),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue({
			songIds: [],
			hiddenSongCount: 3,
		});

		const result = await getMatchReview({ data: { orientation: "song" } });

		expect(result?.caughtUp).toBe(true);
		expect(result?.hiddenSongCount).toBe(3);
		expect(mockGetOrderedUndecidedSongIds).toHaveBeenCalledWith(
			"snap-1",
			"acct-1",
		);
	});

	it("does not compute hiddenSongCount while unresolved items remain", async () => {
		mockFetchActiveSession.mockResolvedValue(
			Result.ok({ id: "session-1", accountId: "acct-1" }),
		);
		vi.mocked(fetchQueueItems).mockResolvedValue(
			Result.ok([
				fakeDomainItem({ id: "item-1", state: "pending", position: 0 }),
			]),
		);

		const result = await getMatchReview({ data: { orientation: "song" } });

		expect(result?.hiddenSongCount).toBe(0);
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
				songId: "song-1",
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
		expect(mockCaptureVisiblePairsAtomic).not.toHaveBeenCalled();
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
		if (result.status === "ready") {
			expect(result.mode).toBe("song");
			expect(result.itemId).toBe("item-1");
			expect(result.reviewItem.id).toBe("song-1");
			expect(result.reviewItem.name).toBe("Test Song");
			expect(result.suggestions).toHaveLength(1);
			expect(result.suggestions[0].playlist.id).toBe("pl-1");
			expect(result.suggestions[0].score).toBe(0.9);
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
		if (result.status === "ready") {
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
});
