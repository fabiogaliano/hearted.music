/**
 * Match review queue service tests.
 *
 * Pure derivation tests need no mocks — they drive deriveUndecidedSongsForQueue
 * directly. Orchestration tests mock the queries module so each test can drive
 * deterministic per-function responses without a live DB or a chainable Supabase
 * fake — this makes concurrent-race and ConstraintError paths straightforward to test.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import type { MatchReviewQueueItem } from "../types";

// ============================================================================
// Orchestration tests — mock the queries layer directly
//
// vi.mock hoists to top of file; all query functions become vi.fn() and each
// test configures exactly the responses it needs. This is more precise than
// mocking the Supabase client chain, and makes concurrent-race / ConstraintError
// paths trivial to exercise.
// ============================================================================

vi.mock("../queries", () => ({
	callResumeMatchReviewSession: vi.fn(),
	fetchActiveSession: vi.fn(),
	insertMatchReviewSession: vi.fn(),
	completeSession: vi.fn(),
	fetchAppliedSnapshotIds: vi.fn(),
	fetchQueuedSongIds: vi.fn(),
	fetchQueuedPlaylistIds: vi.fn(),
	fetchOwnedPlaylistIds: vi.fn(),
	fetchMaxPosition: vi.fn(),
	insertQueueItems: vi.fn(),
	insertQueuePlaylistItems: vi.fn(),
	insertSessionSnapshot: vi.fn(),
	countUnresolvedItems: vi.fn(),
	fetchPendingSongIds: vi.fn(),
	fetchPendingPlaylistIds: vi.fn(),
	updateQueueItemResolved: vi.fn(),
	fetchTargetPlaylistFilters: vi.fn(),
	mapItemToDto: vi.fn(),
}));

vi.mock("../filter-metadata-queries", () => ({
	fetchSongsFilterMeta: vi.fn(),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({
		from: vi.fn(() => ({
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		})),
		rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
	})),
}));

vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	resolveMinMatchScore: vi.fn(async () => 0.5),
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	getNewItemIds: vi.fn(async () => Result.ok<string[], never>([])),
}));

vi.mock("@/lib/domains/taste/song-matching/decision-queries", () => ({
	getMatchDecisionsForSongs: vi.fn(async () => Result.ok<never[], never>([])),
}));

vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getMatchResults: vi.fn(async () => Result.ok<never[], never>([])),
}));

vi.mock("@/lib/observability/capture-product-event", () => ({
	captureProductEventBestEffort: vi.fn(),
}));

// createOrResumeQueue reports a resume-RPC failure through captureServerError
// before falling back to the legacy path (Finding 5). Mock it so the fallback
// tests (which drive the RPC to error by default) don't hit real Sentry and so
// the report can be asserted.
vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: vi.fn(),
}));

import { createAdminSupabaseClient } from "@/lib/data/client";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { getMatchDecisionsForSongs } from "@/lib/domains/taste/song-matching/decision-queries";
import { getMatchResults } from "@/lib/domains/taste/song-matching/queries";
import { fetchSongsFilterMeta } from "../filter-metadata-queries";
import * as queries from "../queries";
// Import after mocks are set up
import {
	getOrderedUndecidedPlaylistIds,
	getOrderedUndecidedSongIds,
	getQueueSummary,
	hasFirstVisibleReviewSubject,
	markItemResolved,
} from "../service";

const ACCOUNT_ID = "account-test-001";
const SESSION_ID = "session-test-001";
const SNAPSHOT_ID = "snapshot-test-001";
function fakeSession() {
	return {
		id: SESSION_ID,
		accountId: ACCOUNT_ID,
		orientation: "song" as const,
		status: "active" as const,
		strictnessPreset: "balanced",
		strictnessMinScore: 0.5,
		createdAt: "2026-06-15T00:00:00Z",
		updatedAt: "2026-06-15T00:00:00Z",
		completedAt: null,
	};
}

function fakeQueueItem(
	overrides: Partial<MatchReviewQueueItem> = {},
): MatchReviewQueueItem {
	return {
		id: "item-001",
		sessionId: SESSION_ID,
		accountId: ACCOUNT_ID,
		songId: "song-001",
		sourceSnapshotId: SNAPSHOT_ID,
		position: 0,
		state: "pending",
		resolution: null,
		sourceScore: 0.8,
		wasNewAtEnqueue: false,
		presentedAt: null,
		resolvedAt: null,
		createdAt: "2026-06-15T00:00:00Z",
		updatedAt: "2026-06-15T00:00:00Z",
		...overrides,
	};
}

function fakeSnapshotRow() {
	return {
		session_id: SESSION_ID,
		snapshot_id: SNAPSHOT_ID,
		appended_item_count: 0,
		applied_at: "2026-06-15T00:00:00Z",
		visibility_config_hash: "legacy",
	};
}

beforeEach(() => {
	vi.clearAllMocks();

	// Default mock returns that tests can override
	vi.mocked(resolveMinMatchScore).mockResolvedValue(0.5);
	vi.mocked(getNewItemIds).mockResolvedValue(Result.ok([]));
	vi.mocked(getMatchDecisionsForSongs).mockResolvedValue(Result.ok([]));
	vi.mocked(getMatchResults).mockResolvedValue(Result.ok([]));

	// Default query mocks — safe no-op defaults
	// Resume RPC defaults to error so tests fall through to the legacy multi-hop
	// path (the RPC is an optimization; existing tests exercise the legacy logic).
	vi.mocked(queries.callResumeMatchReviewSession).mockResolvedValue(
		Result.err(new DatabaseError({ code: "mock", message: "not wired" })),
	);
	vi.mocked(queries.fetchActiveSession).mockResolvedValue(Result.ok(null));
	vi.mocked(queries.insertMatchReviewSession).mockResolvedValue(
		Result.ok(fakeSession()),
	);
	vi.mocked(queries.completeSession).mockResolvedValue(Result.ok(null));
	vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
		Result.ok(new Set<string>()),
	);
	vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
		Result.ok(new Set<string>()),
	);
	vi.mocked(queries.fetchQueuedPlaylistIds).mockResolvedValue(
		Result.ok(new Set<string>()),
	);
	// Default: every requested playlist is owned. The append/summary paths now
	// apply playlist-ownership eligibility in both orientations, so tests that
	// don't exercise ownership staleness get "all owned" and behave as before;
	// ownership-specific tests override this with an explicit subset.
	vi.mocked(queries.fetchOwnedPlaylistIds).mockImplementation(
		async (_acct, ids) => Result.ok(new Set(ids)),
	);
	vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));
	vi.mocked(queries.insertQueueItems).mockResolvedValue(Result.ok(undefined));
	vi.mocked(queries.insertQueuePlaylistItems).mockResolvedValue(
		Result.ok(undefined),
	);
	vi.mocked(queries.insertSessionSnapshot).mockResolvedValue(
		Result.ok(fakeSnapshotRow()),
	);
	vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
	vi.mocked(queries.fetchPendingSongIds).mockResolvedValue(Result.ok([]));
	vi.mocked(queries.fetchPendingPlaylistIds).mockResolvedValue(Result.ok([]));
	vi.mocked(queries.updateQueueItemResolved).mockResolvedValue(
		Result.ok(fakeQueueItem()),
	);
	vi.mocked(queries.fetchTargetPlaylistFilters).mockResolvedValue(
		Result.ok(new Map()),
	);
	vi.mocked(fetchSongsFilterMeta).mockResolvedValue(Result.ok(new Map()));

	// Default Supabase client: no active session, no snapshot
	vi.mocked(createAdminSupabaseClient).mockReturnValue({
		from: vi.fn(() => ({
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		})),
		rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
	} as unknown as ReturnType<typeof createAdminSupabaseClient>);
});

// ============================================================================
// getQueueSummary
// ============================================================================

describe("getQueueSummary", () => {
	it("returns hasActiveQueue=false when no active session exists", async () => {
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(Result.ok(null));

		const result = await getQueueSummary(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.hasActiveQueue).toBe(false);
			expect(result.value.pendingCount).toBe(0);
			expect(result.value.previewSubjectIds).toEqual([]);
		}
	});

	it("song mode uses pending song ids as preview subjects", async () => {
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(
			Result.ok(fakeSession()),
		);
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(5));
		vi.mocked(queries.fetchPendingSongIds).mockResolvedValue(
			Result.ok(["song-a", "song-b"]),
		);

		const result = await getQueueSummary(ACCOUNT_ID, "song");

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.hasActiveQueue).toBe(true);
			expect(result.value.pendingCount).toBe(5);
			expect(result.value.previewSubjectIds).toEqual(["song-a", "song-b"]);
		}
		// Playlist preview path is never used for a song session.
		expect(queries.fetchPendingPlaylistIds).not.toHaveBeenCalled();
	});

	it("playlist mode uses pending playlist ids as preview subjects", async () => {
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(
			Result.ok({ ...fakeSession(), orientation: "playlist" as const }),
		);
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(3));
		vi.mocked(queries.fetchPendingPlaylistIds).mockResolvedValue(
			Result.ok(["pl-a", "pl-b"]),
		);

		const result = await getQueueSummary(ACCOUNT_ID, "playlist");

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.hasActiveQueue).toBe(true);
			expect(result.value.pendingCount).toBe(3);
			expect(result.value.previewSubjectIds).toEqual(["pl-a", "pl-b"]);
		}
		// Song preview path is never used for a playlist session.
		expect(queries.fetchPendingSongIds).not.toHaveBeenCalled();
	});
});

// ============================================================================
// markItemResolved
// ============================================================================

describe("markItemResolved", () => {
	it("marks an item skipped with resolution=skipped", async () => {
		vi.mocked(queries.updateQueueItemResolved).mockResolvedValue(
			Result.ok(fakeQueueItem({ state: "resolved", resolution: "skipped" })),
		);

		const result = await markItemResolved(
			"item-001",
			ACCOUNT_ID,
			"skipped",
			"skipped",
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value?.state).toBe("resolved");
			expect(result.value?.resolution).toBe("skipped");
		}
	});

	it("marks an item completed with resolution=added after one or more adds", async () => {
		vi.mocked(queries.updateQueueItemResolved).mockResolvedValue(
			Result.ok(fakeQueueItem({ state: "resolved", resolution: "added" })),
		);

		const result = await markItemResolved(
			"item-001",
			ACCOUNT_ID,
			"completed",
			"added",
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value?.state).toBe("resolved");
			expect(result.value?.resolution).toBe("added");
		}
	});

	it("marks an item completed with resolution=dismissed", async () => {
		vi.mocked(queries.updateQueueItemResolved).mockResolvedValue(
			Result.ok(fakeQueueItem({ state: "resolved", resolution: "dismissed" })),
		);

		const result = await markItemResolved(
			"item-001",
			ACCOUNT_ID,
			"completed",
			"dismissed",
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value?.resolution).toBe("dismissed");
		}
	});

	it("returns ok(null) when the conditional resolve matched no row (already resolved)", async () => {
		// updateQueueItemResolved is guarded by .in("state", ["pending", "active"])
		// so a concurrent finish/dismiss that already resolved the item leaves this
		// stale call matching nothing — it must surface as ok(null), not a fake success.
		vi.mocked(queries.updateQueueItemResolved).mockResolvedValue(
			Result.ok(null),
		);

		const result = await markItemResolved(
			"item-001",
			ACCOUNT_ID,
			"completed",
			"dismissed",
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toBeNull();
		}
	});
});

describe("getOrderedUndecidedSongIds", () => {
	const songMeta = (language: string | null): SongFilterMetadata => ({
		language,
		languageSecondary: null,
		releaseYear: null,
		vocalGender: null,
		likedAt: null,
	});

	function entitledClient(songIds: string[]) {
		return {
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: songIds.map((song_id) => ({ song_id })),
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>;
	}

	it("orders entitled, visible song subjects and returns them", async () => {
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-b",
					playlist_id: "pl-A",
					score: 0.7,
					fused_score: null,
				},
				{
					song_id: "song-a",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			entitledClient(["song-a", "song-b"]),
		);

		const result = await getOrderedUndecidedSongIds(SNAPSHOT_ID, ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			// Higher score first (no newness), then the lower-scored song.
			expect(result.value.songIds).toEqual(["song-a", "song-b"]);
			expect(result.value.hiddenReviewItemCount).toBe(0);
		}
	});

	it("excludes a filter-hidden song and counts it as hidden (Finding 1)", async () => {
		vi.mocked(queries.fetchTargetPlaylistFilters).mockResolvedValue(
			Result.ok(
				new Map<string, PlaylistMatchFiltersV1 | null>([
					["pl-A", { version: 1, languages: { codes: ["en"] } }],
				]),
			),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-fr",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(fetchSongsFilterMeta).mockResolvedValue(
			Result.ok(new Map([["song-fr", songMeta("fr")]])),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			entitledClient(["song-fr"]),
		);

		const result = await getOrderedUndecidedSongIds(SNAPSHOT_ID, ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			// The strictness-only authority would have advertised song-fr; the
			// policy-aware one hides it and surfaces it behind the hidden count.
			expect(result.value.songIds).toEqual([]);
			expect(result.value.hiddenReviewItemCount).toBe(1);
		}
	});

	it("excludes a song whose only pair points to a non-owned playlist", async () => {
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-gone",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			entitledClient(["song-1"]),
		);
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);

		const result = await getOrderedUndecidedSongIds(SNAPSHOT_ID, ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.songIds).toEqual([]);
			expect(result.value.hiddenReviewItemCount).toBe(0);
		}
	});

	it("surfaces a DB error from the ownership check rather than a falsely-empty preview", async () => {
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			entitledClient(["song-1"]),
		);
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);

		const result = await getOrderedUndecidedSongIds(SNAPSHOT_ID, ACCOUNT_ID);

		expect(result).toBeErr();
	});

	it("freezes the strictness bar to minScoreOverride instead of the live preference", async () => {
		// Live preference is 0.5 (beforeEach). The song scores 0.7 — visible under
		// live strictness — but a frozen 0.8 bar (an active session created stricter)
		// hides it, mirroring the queue/card policy rather than the loosened live bar.
		vi.mocked(resolveMinMatchScore).mockResolvedValue(0.5);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.7,
					fused_score: null,
				},
			]),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			entitledClient(["song-1"]),
		);

		const result = await getOrderedUndecidedSongIds(
			SNAPSHOT_ID,
			ACCOUNT_ID,
			0.8,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.songIds).toEqual([]);
			expect(result.value.hiddenReviewItemCount).toBe(1);
		}
		// The override short-circuits the live resolve entirely.
		expect(resolveMinMatchScore).not.toHaveBeenCalled();
	});
});

describe("getOrderedUndecidedPlaylistIds", () => {
	// Two entitled, undecided playlists: pl-visible clears the 0.5 bar, pl-hidden
	// sits below it. pl-hidden therefore drives the hidden count, pl-visible the
	// returned playlistIds.
	function seedTwoPlaylists() {
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-visible",
					playlist_id: "pl-visible",
					score: 0.9,
					fused_score: null,
				},
				{
					song_id: "song-hidden",
					playlist_id: "pl-hidden",
					score: 0.3,
					fused_score: null,
				},
			]),
		);
		// Both songs entitled, so both playlists are actionable candidates.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-visible" }, { song_id: "song-hidden" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
	}

	it("counts a hidden playlist that is still owned", async () => {
		seedTwoPlaylists();
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set(["pl-visible", "pl-hidden"])),
		);

		const result = await getOrderedUndecidedPlaylistIds(
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.playlistIds).toEqual(["pl-visible"]);
			expect(result.value.hiddenReviewItemCount).toBe(1);
		}
	});

	it("excludes a no-longer-owned playlist from the hidden count", async () => {
		seedTwoPlaylists();
		// pl-hidden was deleted/transferred — a stale snapshot still references it,
		// but it must not inflate the hidden count.
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set(["pl-visible"])),
		);

		const result = await getOrderedUndecidedPlaylistIds(
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.playlistIds).toEqual(["pl-visible"]);
			expect(result.value.hiddenReviewItemCount).toBe(0);
		}
		// Visible and hidden IDs are ownership-checked together in a single query.
		expect(queries.fetchOwnedPlaylistIds).toHaveBeenCalledTimes(1);
		const checkedIds = vi.mocked(queries.fetchOwnedPlaylistIds).mock
			.calls[0]?.[1];
		expect([...(checkedIds ?? [])].toSorted()).toEqual([
			"pl-hidden",
			"pl-visible",
		]);
	});

	it("surfaces a DB error from the ownership check rather than a falsely-empty preview", async () => {
		seedTwoPlaylists();
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);

		const result = await getOrderedUndecidedPlaylistIds(
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeErr();
	});

	it("freezes the strictness bar to minScoreOverride instead of the live preference", async () => {
		seedTwoPlaylists();
		vi.mocked(resolveMinMatchScore).mockResolvedValue(0.5);

		// Live 0.5 would keep pl-visible (0.9) shown and pl-hidden (0.3) hidden. A
		// frozen 0.95 bar — the active session's stored strictness — hides both, so
		// the active caught-up count must reflect two hidden playlists, not one.
		const result = await getOrderedUndecidedPlaylistIds(
			SNAPSHOT_ID,
			ACCOUNT_ID,
			0.95,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.playlistIds).toEqual([]);
			expect(result.value.hiddenReviewItemCount).toBe(2);
		}
		expect(resolveMinMatchScore).not.toHaveBeenCalled();
	});

	it("does not let a non-entitled pair's score reorder playlists", async () => {
		// pl-A's only high score (0.99) comes from a non-entitled song; its only
		// entitled pair scores 0.60. pl-B has an entitled pair at 0.90. The queue,
		// which orders off eligible pairs, ranks pl-B before pl-A — the preview must
		// match, never letting pl-A's locked 0.99 pull it to the front.
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "locked",
					playlist_id: "pl-A",
					score: 0.99,
					fused_score: null,
				},
				{
					song_id: "entitled-a",
					playlist_id: "pl-A",
					score: 0.6,
					fused_score: null,
				},
				{
					song_id: "entitled-b",
					playlist_id: "pl-B",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		// "locked" is intentionally absent from the entitled set.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "entitled-a" }, { song_id: "entitled-b" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await getOrderedUndecidedPlaylistIds(
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.playlistIds).toEqual(["pl-B", "pl-A"]);
		}
	});
});

// ============================================================================
// hasFirstVisibleReviewSubject
// ============================================================================

describe("hasFirstVisibleReviewSubject", () => {
	// Returns a Supabase mock that answers the snapshot lookup with the given id
	// and the entitlement RPC with the given song ids. Suitable for snapshot-path
	// tests where active queues are empty (default mocks).
	function snapshotAndEntitlementClient(
		snapshotId: string,
		entitledSongIds: string[],
	) {
		return {
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: snapshotId }, error: null }),
			})),
			rpc: vi.fn().mockResolvedValue({
				data: entitledSongIds.map((song_id) => ({ song_id })),
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>;
	}

	it("returns false when the snapshot's only pair is below the balanced strictness threshold (fused_score 0.49)", async () => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			snapshotAndEntitlementClient(SNAPSHOT_ID, ["song-1"]),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.49,
					fused_score: 0.49,
				},
			]),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
	});

	it("returns true when the snapshot has a visible undecided pair at fused_score 0.50", async () => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			snapshotAndEntitlementClient(SNAPSHOT_ID, ["song-1"]),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.5,
					fused_score: 0.5,
				},
			]),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(true);
	});

	it("returns false when the only above-threshold pair has already been decided", async () => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			snapshotAndEntitlementClient(SNAPSHOT_ID, ["song-1"]),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.8,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchDecisionsForSongs).mockResolvedValue(
			Result.ok([
				{
					id: "dec-1",
					account_id: ACCOUNT_ID,
					song_id: "song-1",
					playlist_id: "pl-A",
					decision: "dismissed" as const,
					decided_at: "2026-06-15T00:00:00Z",
					created_at: "2026-06-15T00:00:00Z",
					snapshot_id: null,
					model_rank: null,
					visible_rank: null,
					served_orientation: null,
					queue_item_id: null,
				},
			]),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
	});

	it("returns false when the only pair is hidden by playlist filters", async () => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			snapshotAndEntitlementClient(SNAPSHOT_ID, ["song-fr"]),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-fr",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		// pl-A filters to English only; this French song fails it.
		vi.mocked(queries.fetchTargetPlaylistFilters).mockResolvedValue(
			Result.ok(
				new Map<string, PlaylistMatchFiltersV1 | null>([
					["pl-A", { version: 1, languages: { codes: ["en"] } }],
				]),
			),
		);
		vi.mocked(fetchSongsFilterMeta).mockResolvedValue(
			Result.ok(
				new Map([
					[
						"song-fr",
						{
							language: "fr",
							languageSecondary: null,
							releaseYear: null,
							vocalGender: null,
							likedAt: null,
						},
					],
				]),
			),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
	});

	it("returns false when the only song in the snapshot is not entitled", async () => {
		// Entitlement RPC returns empty — the song is not entitled.
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			snapshotAndEntitlementClient(SNAPSHOT_ID, []),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.8,
					fused_score: null,
				},
			]),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
	});

	it("returns true when a playlist-mode subject is visible in the snapshot", async () => {
		// An owned playlist with one entitled, above-threshold, undecided suggestion
		// song produces a visible playlist subject even without a song subject.
		// (Both orientations contribute — this exercises the playlist path.)
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			snapshotAndEntitlementClient(SNAPSHOT_ID, ["song-1"]),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.8,
					fused_score: null,
				},
			]),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		// Any pair that yields a playlist subject also yields a song subject under the
		// current data model, so isolating the playlist branch from the song branch is
		// structurally impossible here — this test exercises the playlist code path but
		// the song path alone would also satisfy the OR.
		if (Result.isOk(result)) expect(result.value).toBe(true);
	});

	it("returns true immediately when an active queue has pending items, without reading match results", async () => {
		// Active song queue already has pending items — short-circuit before snapshot.
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(
			Result.ok(fakeSession()),
		);
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(2));
		vi.mocked(queries.fetchPendingSongIds).mockResolvedValue(
			Result.ok(["song-1", "song-2"]),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(true);
		// getMatchResults must not be called — the queue summary short-circuited.
		expect(getMatchResults).not.toHaveBeenCalled();
	});

	it("returns false when there is no snapshot and no active queue", async () => {
		// Default beforeEach: fetchActiveSession → null, maybeSingle → null.

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
	});

	it("propagates a DB error from the snapshot lookup rather than collapsing it to false", async () => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi.fn().mockResolvedValue({
					data: null,
					error: { code: "08006", message: "conn lost" },
				}),
			})),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeErr();
	});
});
