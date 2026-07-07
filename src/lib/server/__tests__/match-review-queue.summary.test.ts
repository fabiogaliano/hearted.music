/**
 * Phase 7 — resolveMatchReviewSummary and getMatchReviewSummary
 *
 * Tests cover:
 * - active-queue path: count + ordered previews from queue
 * - snapshot-fallback path: derives from latest snapshot when no active queue
 * - no items in either path → pendingCount 0, previewImages []
 * - image lookup failure → returns empty previewImages but keeps pendingCount
 * - getMatchReviewSummary server fn delegates to resolveMatchReviewSummary
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getMatchReviewSummary,
	getPreferredMatchReviewSummary,
	resolveMatchReviewSummary,
	resolvePreferredMatchReviewSummary,
} from "../match-review-queue.functions";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
	mockAuthContext,
	mockGetQueueSummary,
	mockGetLatestMatchSnapshot,
	mockGetOrderedUndecidedSongIds,
	mockGetOrderedUndecidedPlaylistIds,
	mockGetPreferredMatchViewMode,
	mockRpc,
	mockFrom,
	mockSelect,
	mockIn,
} = vi.hoisted(() => {
	const mockIn = vi.fn();
	const mockSelect = vi.fn().mockReturnValue({ in: mockIn });
	const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

	return {
		mockAuthContext: {
			session: { accountId: "acct-1" },
			account: null,
		},
		mockGetQueueSummary: vi.fn(),
		mockGetLatestMatchSnapshot: vi.fn(),
		mockGetOrderedUndecidedSongIds: vi.fn(),
		mockGetOrderedUndecidedPlaylistIds: vi.fn(),
		mockGetPreferredMatchViewMode: vi.fn(),
		mockRpc: vi.fn(),
		mockFrom,
		mockSelect,
		mockIn,
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

vi.mock("@/lib/domains/taste/match-review-queue/service", () => ({
	getQueueSummary: (...args: unknown[]) => mockGetQueueSummary(...args),
	getOrderedUndecidedSongIds: (...args: unknown[]) =>
		mockGetOrderedUndecidedSongIds(...args),
	getOrderedUndecidedPlaylistIds: (...args: unknown[]) =>
		mockGetOrderedUndecidedPlaylistIds(...args),
	markItemPresented: vi.fn(),
	markItemResolved: vi.fn(),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: (...args: unknown[]) =>
		mockGetLatestMatchSnapshot(...args),
	getMatchResultDetailsForSong: vi.fn(),
	getServedRanksForSong: vi.fn(),
}));

vi.mock("@/lib/domains/taste/song-matching/decision-queries", () => ({
	getMatchDecisionsForSongs: vi.fn(),
	upsertMatchDecision: vi.fn(),
	upsertMatchDecisions: vi.fn(),
}));

vi.mock("@/lib/domains/taste/match-review-queue/queries", () => ({
	addQueueItemDecisionAtomically: vi.fn(),
	dismissQueueItemAtomically: vi.fn(),
	fetchActiveSession: vi.fn(),
	fetchQueueItems: vi.fn(),
	finishQueueItemAtomically: vi.fn(),
}));

vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	getPreferredMatchViewMode: (...args: unknown[]) =>
		mockGetPreferredMatchViewMode(...args),
	getOrCreatePreferences: vi.fn(),
	setPreferredMatchViewMode: vi.fn(),
}));

// ---------------------------------------------------------------------------
// resolveMatchReviewSummary — active-queue path
// ---------------------------------------------------------------------------

describe("resolveMatchReviewSummary — active-queue path", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset the from mock chain to avoid cross-test pollution
		mockIn.mockReset();
		mockSelect.mockReturnValue({ in: mockIn });
		mockFrom.mockReturnValue({ select: mockSelect });
	});

	it("returns queue pendingCount and queue-ordered preview images", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: true,
				pendingCount: 5,
				previewSubjectIds: ["song-1", "song-2", "song-3"],
			}),
		);
		mockIn.mockResolvedValue({
			data: [
				{
					id: "song-1",
					image_url: "img1.jpg",
					name: "Track 1",
					artists: ["A1"],
				},
				{
					id: "song-2",
					image_url: "img2.jpg",
					name: "Track 2",
					artists: ["A2"],
				},
				{
					id: "song-3",
					image_url: "img3.jpg",
					name: "Track 3",
					artists: ["A3"],
				},
			],
			error: null,
		});

		const result = await resolveMatchReviewSummary("acct-1", "song");

		expect(result.pendingCount).toBe(5);
		expect(result.hasActiveQueue).toBe(true);
		expect(result.previewImages).toHaveLength(3);
		expect(result.previewImages[0]).toEqual({
			id: 1,
			image: "img1.jpg",
			name: "Track 1",
			artist: "A1",
		});
		expect(result.previewImages[1]).toEqual({
			id: 2,
			image: "img2.jpg",
			name: "Track 2",
			artist: "A2",
		});
		expect(result.previewImages[2]).toEqual({
			id: 3,
			image: "img3.jpg",
			name: "Track 3",
			artist: "A3",
		});
		// Snapshot-fallback path must NOT be called when queue is active.
		expect(mockGetLatestMatchSnapshot).not.toHaveBeenCalled();
	});

	it("caps previews at top 3 from the queue's previewSubjectIds", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: true,
				pendingCount: 10,
				// The queue service already slices; resolver also caps at 3.
				previewSubjectIds: ["s1", "s2", "s3", "s4"],
			}),
		);
		mockIn.mockResolvedValue({
			data: [
				{ id: "s1", image_url: "a.jpg", name: "T1", artists: ["A1"] },
				{ id: "s2", image_url: "b.jpg", name: "T2", artists: ["A2"] },
				{ id: "s3", image_url: "c.jpg", name: "T3", artists: ["A3"] },
			],
			error: null,
		});

		const result = await resolveMatchReviewSummary("acct-1", "song");

		expect(mockIn).toHaveBeenCalledWith("id", ["s1", "s2", "s3"]);
		expect(result.previewImages).toHaveLength(3);
	});

	it("returns pendingCount 0 and empty previewImages when queue is active but empty", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: true,
				pendingCount: 0,
				previewSubjectIds: [],
			}),
		);

		const result = await resolveMatchReviewSummary("acct-1", "song");

		expect(result.pendingCount).toBe(0);
		expect(result.previewImages).toHaveLength(0);
		expect(mockFrom).not.toHaveBeenCalled();
	});

	it("returns empty previewImages when image lookup fails but keeps pendingCount", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: true,
				pendingCount: 3,
				previewSubjectIds: ["song-a", "song-b"],
			}),
		);
		mockIn.mockResolvedValue({ data: null, error: new Error("db error") });

		const result = await resolveMatchReviewSummary("acct-1", "song");

		expect(result.pendingCount).toBe(3);
		expect(result.previewImages).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// resolveMatchReviewSummary — playlist orientation (Finding 4)
// ---------------------------------------------------------------------------

describe("resolveMatchReviewSummary — playlist orientation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIn.mockReset();
		mockSelect.mockReturnValue({ in: mockIn });
		mockFrom.mockReturnValue({ select: mockSelect });
	});

	it("active queue: previews come from the playlist table with empty artist", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: true,
				pendingCount: 4,
				previewSubjectIds: ["pl-1", "pl-2"],
			}),
		);
		mockIn.mockResolvedValue({
			data: [
				{ id: "pl-1", image_url: "p1.jpg", name: "Playlist One" },
				{ id: "pl-2", image_url: "p2.jpg", name: "Playlist Two" },
			],
			error: null,
		});

		const result = await resolveMatchReviewSummary("acct-1", "playlist");

		expect(result.orientation).toBe("playlist");
		expect(result.pendingCount).toBe(4);
		expect(mockFrom).toHaveBeenCalledWith("playlist");
		expect(result.previewImages).toHaveLength(2);
		expect(result.previewImages[0]).toEqual({
			id: 1,
			image: "p1.jpg",
			name: "Playlist One",
			artist: "",
		});
		// Snapshot-fallback path must NOT be called when queue is active.
		expect(mockGetOrderedUndecidedPlaylistIds).not.toHaveBeenCalled();
	});

	it("snapshot fallback: derives playlist subjects and maps playlist previews", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: false,
				pendingCount: 0,
				previewSubjectIds: [],
			}),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedPlaylistIds.mockResolvedValue(
			Result.ok({ playlistIds: ["pl-1", "pl-2"], hiddenReviewItemCount: 0 }),
		);
		mockIn.mockResolvedValue({
			data: [
				{ id: "pl-1", image_url: "p1.jpg", name: "Playlist One" },
				{ id: "pl-2", image_url: "p2.jpg", name: "Playlist Two" },
			],
			error: null,
		});

		const result = await resolveMatchReviewSummary("acct-1", "playlist");

		expect(result.orientation).toBe("playlist");
		expect(result.pendingCount).toBe(2);
		expect(result.hasActiveQueue).toBe(false);
		expect(mockGetOrderedUndecidedPlaylistIds).toHaveBeenCalledWith(
			"snap-1",
			"acct-1",
		);
		// Song fallback authority is never used for playlist orientation.
		expect(mockGetOrderedUndecidedSongIds).not.toHaveBeenCalled();
		expect(result.previewImages).toHaveLength(2);
		expect(result.previewImages[1]).toEqual({
			id: 2,
			image: "p2.jpg",
			name: "Playlist Two",
			artist: "",
		});
	});

	it("snapshot fallback: a derivation error yields an empty summary", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: false,
				pendingCount: 0,
				previewSubjectIds: [],
			}),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedPlaylistIds.mockResolvedValue(
			Result.err(new Error("boom")),
		);

		const result = await resolveMatchReviewSummary("acct-1", "playlist");

		expect(result.pendingCount).toBe(0);
		expect(result.previewImages).toHaveLength(0);
		expect(result.orientation).toBe("playlist");
	});
});

// ---------------------------------------------------------------------------
// resolveMatchReviewSummary — snapshot-fallback path (no active queue)
// ---------------------------------------------------------------------------

describe("resolveMatchReviewSummary — snapshot-fallback path", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIn.mockReset();
		mockSelect.mockReturnValue({ in: mockIn });
		mockFrom.mockReturnValue({ select: mockSelect });
	});

	it("falls back to snapshot-derived count and previews when no active queue", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: false,
				pendingCount: 0,
				previewSubjectIds: [],
			}),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue(
			Result.ok({ songIds: ["song-x", "song-y"], hiddenReviewItemCount: 0 }),
		);
		mockIn.mockResolvedValue({
			data: [
				{ id: "song-x", image_url: "x.jpg", name: "Track X", artists: ["AX"] },
				{ id: "song-y", image_url: "y.jpg", name: "Track Y", artists: ["AY"] },
			],
			error: null,
		});

		const result = await resolveMatchReviewSummary("acct-1", "song");

		expect(result.hasActiveQueue).toBe(false);
		// pendingCount comes from songIds.length in fallback path.
		expect(result.pendingCount).toBe(2);
		expect(result.previewImages).toHaveLength(2);
		expect(result.previewImages[0]).toEqual({
			id: 1,
			image: "x.jpg",
			name: "Track X",
			artist: "AX",
		});
		expect(mockGetOrderedUndecidedSongIds).toHaveBeenCalledWith(
			"snap-1",
			"acct-1",
		);
	});

	it("returns pendingCount 0 when no snapshot exists", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: false,
				pendingCount: 0,
				previewSubjectIds: [],
			}),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));

		const result = await resolveMatchReviewSummary("acct-1", "song");

		expect(result.pendingCount).toBe(0);
		expect(result.previewImages).toHaveLength(0);
		expect(mockGetOrderedUndecidedSongIds).not.toHaveBeenCalled();
	});

	it("returns pendingCount 0 when snapshot has no undecided songs", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: false,
				pendingCount: 0,
				previewSubjectIds: [],
			}),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue(
			Result.ok({ songIds: [], hiddenReviewItemCount: 0 }),
		);

		const result = await resolveMatchReviewSummary("acct-1", "song");

		expect(result.pendingCount).toBe(0);
		expect(result.previewImages).toHaveLength(0);
		expect(mockFrom).not.toHaveBeenCalled();
	});

	it("caps fallback previews at 3 songs", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: false,
				pendingCount: 0,
				previewSubjectIds: [],
			}),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue(
			Result.ok({
				songIds: ["s1", "s2", "s3", "s4", "s5"],
				hiddenReviewItemCount: 0,
			}),
		);
		mockIn.mockResolvedValue({
			data: [
				{ id: "s1", image_url: "a.jpg", name: "T1", artists: ["A1"] },
				{ id: "s2", image_url: "b.jpg", name: "T2", artists: ["A2"] },
				{ id: "s3", image_url: "c.jpg", name: "T3", artists: ["A3"] },
			],
			error: null,
		});

		const result = await resolveMatchReviewSummary("acct-1", "song");

		// pendingCount is total undecided, not capped.
		expect(result.pendingCount).toBe(5);
		// Image lookup only for top-3.
		expect(mockIn).toHaveBeenCalledWith("id", ["s1", "s2", "s3"]);
		expect(result.previewImages).toHaveLength(3);
	});

	it("falls back gracefully when getQueueSummary returns an error", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.err({ _tag: "DatabaseError", message: "connection failed" }),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok({ id: "snap-1" }));
		mockGetOrderedUndecidedSongIds.mockResolvedValue(
			Result.ok({ songIds: ["song-z"], hiddenReviewItemCount: 0 }),
		);
		mockIn.mockResolvedValue({
			data: [
				{ id: "song-z", image_url: "z.jpg", name: "Track Z", artists: ["AZ"] },
			],
			error: null,
		});

		const result = await resolveMatchReviewSummary("acct-1", "song");

		// Error from getQueueSummary → treated as no active queue → snapshot fallback.
		expect(result.hasActiveQueue).toBe(false);
		expect(result.pendingCount).toBe(1);
		expect(result.previewImages).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// getMatchReviewSummary server fn
// ---------------------------------------------------------------------------

describe("getMatchReviewSummary — server fn", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIn.mockReset();
		mockSelect.mockReturnValue({ in: mockIn });
		mockFrom.mockReturnValue({ select: mockSelect });
	});

	it("delegates to resolveMatchReviewSummary with the authed accountId", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: true,
				pendingCount: 7,
				previewSubjectIds: ["song-1"],
			}),
		);
		mockIn.mockResolvedValue({
			data: [
				{
					id: "song-1",
					image_url: "cover.jpg",
					name: "Track 1",
					artists: ["A1"],
				},
			],
			error: null,
		});

		const result = await getMatchReviewSummary({
			data: { orientation: "song" },
		});

		expect(result.pendingCount).toBe(7);
		expect(result.hasActiveQueue).toBe(true);
		expect(result.previewImages).toHaveLength(1);
		expect(mockGetQueueSummary).toHaveBeenCalledWith("acct-1", "song");
	});

	it("returns pendingCount 0 when caught up (no active queue, no snapshot)", async () => {
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: false,
				pendingCount: 0,
				previewSubjectIds: [],
			}),
		);
		mockGetLatestMatchSnapshot.mockResolvedValue(Result.ok(null));

		const result = await getMatchReviewSummary({
			data: { orientation: "song" },
		});

		expect(result.pendingCount).toBe(0);
		expect(result.previewImages).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// resolvePreferredMatchReviewSummary
// ---------------------------------------------------------------------------

describe("resolvePreferredMatchReviewSummary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIn.mockReset();
		mockSelect.mockReturnValue({ in: mockIn });
		mockFrom.mockReturnValue({ select: mockSelect });
	});

	it("delegates to song orientation when preference is 'song'", async () => {
		mockGetPreferredMatchViewMode.mockResolvedValue("song");
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: true,
				pendingCount: 4,
				previewSubjectIds: ["s1"],
			}),
		);
		mockIn.mockResolvedValue({
			data: [{ id: "s1", image_url: "a.jpg", name: "T1", artists: ["A1"] }],
			error: null,
		});

		const result = await resolvePreferredMatchReviewSummary("acct-1");

		expect(result.orientation).toBe("song");
		expect(result.pendingCount).toBe(4);
		expect(mockGetQueueSummary).toHaveBeenCalledWith("acct-1", "song");
	});

	it("delegates to playlist orientation when preference is 'playlist'", async () => {
		mockGetPreferredMatchViewMode.mockResolvedValue("playlist");
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: true,
				pendingCount: 2,
				previewSubjectIds: [],
			}),
		);

		const result = await resolvePreferredMatchReviewSummary("acct-1");

		expect(result.orientation).toBe("playlist");
		expect(result.pendingCount).toBe(2);
		expect(mockGetQueueSummary).toHaveBeenCalledWith("acct-1", "playlist");
	});
});

// ---------------------------------------------------------------------------
// getPreferredMatchReviewSummary server fn
// ---------------------------------------------------------------------------

describe("getPreferredMatchReviewSummary — server fn", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIn.mockReset();
		mockSelect.mockReturnValue({ in: mockIn });
		mockFrom.mockReturnValue({ select: mockSelect });
	});

	it("returns summary with orientation from stored preference", async () => {
		mockGetPreferredMatchViewMode.mockResolvedValue("playlist");
		mockGetQueueSummary.mockResolvedValue(
			Result.ok({
				hasActiveQueue: true,
				pendingCount: 3,
				previewSubjectIds: [],
			}),
		);

		const result = await getPreferredMatchReviewSummary({ data: undefined });

		expect(result.orientation).toBe("playlist");
		expect(result.pendingCount).toBe(3);
	});
});
