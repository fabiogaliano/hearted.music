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
import { ConstraintError, DatabaseError } from "@/lib/shared/errors/database";
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
	updateQueueItemPresented: vi.fn(),
	updateQueueItemResolved: vi.fn(),
	clearSongNewness: vi.fn(),
	fetchTargetPlaylistFilters: vi.fn(),
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
	appendSnapshotDelta,
	createOrResumeQueue,
	getOrderedUndecidedPlaylistIds,
	getOrderedUndecidedSongIds,
	getQueueSummary,
	hasFirstVisibleReviewSubject,
	markItemPresented,
	markItemResolved,
	syncActiveQueue,
} from "../service";
import {
	computeReadTimeFiltersHash,
	computeVisibilityConfigHash,
} from "../visibility-policy";

const ACCOUNT_ID = "account-test-001";
const SESSION_ID = "session-test-001";
const SNAPSHOT_ID = "snapshot-test-001";
// Visibility hash for fakeSession() (orientation='song', strictnessMinScore=0.5,
// empty filter map) — derived dynamically so it stays in sync with the hash impl.
const SONG_VISIBILITY_HASH = computeVisibilityConfigHash({
	orientation: "song",
	minScore: 0.5,
	readTimeFiltersHash: computeReadTimeFiltersHash(new Map()),
});
const SONG_APPLIED_KEY = `${SNAPSHOT_ID}:${SONG_VISIBILITY_HASH}`;

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
	vi.mocked(queries.updateQueueItemPresented).mockResolvedValue(
		Result.ok(fakeQueueItem()),
	);
	vi.mocked(queries.updateQueueItemResolved).mockResolvedValue(
		Result.ok(fakeQueueItem()),
	);
	vi.mocked(queries.clearSongNewness).mockResolvedValue(undefined);
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
// createOrResumeQueue
// ============================================================================

describe("createOrResumeQueue", () => {
	it("resumes an existing active session without creating a new one", async () => {
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(
			Result.ok(fakeSession()),
		);
		// Pass still in progress — unresolved items remain, so no rollover.
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(3));

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("resumed");
			if (result.value.kind === "resumed") {
				expect(result.value.session.id).toBe(SESSION_ID);
			}
		}
		expect(queries.insertMatchReviewSession).not.toHaveBeenCalled();
		// In-progress pass is resumed as-is, never completed/rolled over.
		expect(queries.completeSession).not.toHaveBeenCalled();
	});

	it("returns no_snapshot when no active session and no snapshot exists", async () => {
		// fetchActiveSession returns null — no active session
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(Result.ok(null));
		// Supabase match_snapshot query returns null
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

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("no_snapshot");
		}
	});

	it("creates a new session when none is active and a snapshot exists", async () => {
		// No active session on initial check
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(Result.ok(null));
		// insertMatchReviewSession succeeds
		const session = fakeSession();
		vi.mocked(queries.insertMatchReviewSession).mockResolvedValue(
			Result.ok(session),
		);
		// Supabase returns a snapshot
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: SNAPSHOT_ID }, error: null }),
			})),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		// appendSnapshotDelta internals: no applied snapshots, no match results
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(Result.ok([]));
		vi.mocked(queries.insertSessionSnapshot).mockResolvedValue(
			Result.ok(fakeSnapshotRow()),
		);

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("created");
			if (result.value.kind === "created") {
				// Stored strictness is set from resolveMinMatchScore at creation time
				expect(result.value.session.strictnessMinScore).toBe(0.5);
				expect(result.value.session.strictnessPreset).toBe("balanced");
				expect(result.value.appendedCount).toBe(0);
			}
		}
		expect(queries.insertMatchReviewSession).toHaveBeenCalledOnce();
	});

	it("falls back to the winner's session when insertMatchReviewSession races (ConstraintError)", async () => {
		const winnerSession = { ...fakeSession(), id: "session-winner-002" };

		// No active session on initial check
		vi.mocked(queries.fetchActiveSession)
			// First call: no existing session (so we try to create)
			.mockResolvedValueOnce(Result.ok(null))
			// Second call (race fallback): returns the winner's session
			.mockResolvedValueOnce(Result.ok(winnerSession));

		// insertMatchReviewSession loses the race → ConstraintError
		vi.mocked(queries.insertMatchReviewSession).mockResolvedValue(
			Result.err(new ConstraintError("idx_match_review_session_one_active")),
		);

		// Supabase returns a snapshot (needed to get past the no-snapshot guard)
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: SNAPSHOT_ID }, error: null }),
			})),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			// Falls back to resumed with the winner's session — no crash
			expect(result.value.kind).toBe("resumed");
			if (result.value.kind === "resumed") {
				expect(result.value.session.id).toBe("session-winner-002");
			}
		}
		// fetchActiveSession called twice: initial check + race fallback
		expect(queries.fetchActiveSession).toHaveBeenCalledTimes(2);
	});

	it("syncs the latest snapshot into an existing active session on resume", async () => {
		// Existing active session — the resume path must append the latest snapshot
		// so a browser that missed the live-append still picks up new matches.
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(
			Result.ok(fakeSession()),
		);
		// In-progress pass (unresolved items remain) — resume, do not roll over.
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(2));
		// Latest snapshot exists and has not yet been applied.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: SNAPSHOT_ID }, error: null }),
			})),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(Result.ok([]));

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("resumed");
		}
		// The append actually ran against the existing session: it read the
		// snapshot's results and recorded the snapshot as applied with the hash.
		expect(getMatchResults).toHaveBeenCalledWith(SNAPSHOT_ID);
		expect(queries.insertSessionSnapshot).toHaveBeenCalledWith(
			SESSION_ID,
			SNAPSHOT_ID,
			0,
			SONG_VISIBILITY_HASH,
		);
		// No new session was created — this is a resume, not a create.
		expect(queries.insertMatchReviewSession).not.toHaveBeenCalled();
	});

	it("resume is a no-op when the latest snapshot was already applied", async () => {
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(
			Result.ok(fakeSession()),
		);
		// In-progress pass — resume, not rollover.
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(1));
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: SNAPSHOT_ID }, error: null }),
			})),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		// Snapshot already applied with same hash → idempotency guard short-circuits.
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set([SONG_APPLIED_KEY])),
		);

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("resumed");
		}
		// Already-applied snapshot: no items inserted and no snapshot re-recorded.
		expect(queries.insertQueueItems).not.toHaveBeenCalled();
		expect(queries.insertSessionSnapshot).not.toHaveBeenCalled();
		expect(getMatchResults).not.toHaveBeenCalled();
	});

	it("propagates the error when appendSnapshotDelta fails on a freshly created session", async () => {
		// No active session — we create one, then the snapshot append fails.
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(Result.ok(null));
		vi.mocked(queries.insertMatchReviewSession).mockResolvedValue(
			Result.ok(fakeSession()),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: SNAPSHOT_ID }, error: null }),
			})),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		// appendSnapshotDelta fails at its first DB step. The error must propagate
		// rather than degrade to a "created, appendedCount 0" success that would
		// permanently hide the snapshot's matches.
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeErr();
	});

	it("appends the latest snapshot into the winner's session on race fallback", async () => {
		// Regression for the race where the loser returned the winner's bare session
		// without appending — rendering an empty/caught-up queue for a pass that
		// actually has matches. The fallback must run the same latest-snapshot append.
		const winnerSession = { ...fakeSession(), id: "session-winner-003" };
		vi.mocked(queries.fetchActiveSession)
			.mockResolvedValueOnce(Result.ok(null))
			.mockResolvedValueOnce(Result.ok(winnerSession));
		vi.mocked(queries.insertMatchReviewSession).mockResolvedValue(
			Result.err(new ConstraintError("idx_match_review_session_one_active")),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: SNAPSHOT_ID }, error: null }),
			})),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("resumed");
		}
		// The append actually ran against the winner's session — it read the latest
		// snapshot's results and recorded the snapshot (with hash) as applied to the winner.
		expect(getMatchResults).toHaveBeenCalledWith(SNAPSHOT_ID);
		expect(queries.insertSessionSnapshot).toHaveBeenCalledWith(
			"session-winner-003",
			SNAPSHOT_ID,
			0,
			SONG_VISIBILITY_HASH,
		);
	});

	it("propagates the error when the race-fallback append fails", async () => {
		// A failed append in the fallback must surface, not degrade to an empty
		// "resumed" success that hides the winner's matches.
		const winnerSession = { ...fakeSession(), id: "session-winner-004" };
		vi.mocked(queries.fetchActiveSession)
			.mockResolvedValueOnce(Result.ok(null))
			.mockResolvedValueOnce(Result.ok(winnerSession));
		vi.mocked(queries.insertMatchReviewSession).mockResolvedValue(
			Result.err(new ConstraintError("idx_match_review_session_one_active")),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: SNAPSHOT_ID }, error: null }),
			})),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		// appendLatestSnapshot fails at its first DB step.
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeErr();
	});
});

// ============================================================================
// createOrResumeQueue — pass rollover (skipped songs return in a future pass)
// ============================================================================

describe("createOrResumeQueue pass rollover", () => {
	function activeSnapshotClient(songIds: string[]) {
		// match_snapshot lookup returns the latest snapshot; entitlement RPC returns
		// the given song ids as entitled.
		return {
			from: vi.fn(() => ({
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				limit: vi.fn().mockReturnThis(),
				maybeSingle: vi
					.fn()
					.mockResolvedValue({ data: { id: SNAPSHOT_ID }, error: null }),
			})),
			rpc: vi.fn().mockResolvedValue({
				data: songIds.map((song_id) => ({ song_id })),
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>;
	}

	it("completes a caught-up active session and creates a fresh pass", async () => {
		// Active session exists but every item is resolved (caught up).
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(
			Result.ok(fakeSession()),
		);
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set(["snap-old"])),
		);
		vi.mocked(queries.completeSession).mockResolvedValue(
			Result.ok({ ...fakeSession(), status: "completed" as const }),
		);
		// Fresh pass is created from a different session id.
		const freshSession = { ...fakeSession(), id: "session-fresh-001" };
		vi.mocked(queries.insertMatchReviewSession).mockResolvedValue(
			Result.ok(freshSession),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			activeSnapshotClient([]),
		);

		const result = await createOrResumeQueue(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("created");
			if (result.value.kind === "created") {
				expect(result.value.session.id).toBe("session-fresh-001");
			}
		}
		// The caught-up pass was completed before the fresh one was created.
		expect(queries.completeSession).toHaveBeenCalledWith(
			SESSION_ID,
			ACCOUNT_ID,
		);
		expect(queries.insertMatchReviewSession).toHaveBeenCalledOnce();
	});

	it("syncActiveQueue maps rolled-over-and-created to appendedCount from fresh queue", async () => {
		// Thin adapter mapping test: when the decision tree rolls over, syncActiveQueue
		// surfaces the new pass's appendedCount (not zero) so callers know matches arrived.
		vi.mocked(queries.fetchActiveSession).mockResolvedValue(
			Result.ok(fakeSession()),
		);
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set(["snap-old"])),
		);
		vi.mocked(queries.completeSession).mockResolvedValue(
			Result.ok({ ...fakeSession(), status: "completed" as const }),
		);
		vi.mocked(queries.insertMatchReviewSession).mockResolvedValue(
			Result.ok({ ...fakeSession(), id: "session-fresh-sync" }),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-skipped",
					playlist_id: "pl-A",
					score: 0.8,
					fused_score: null,
				},
			]),
		);
		vi.mocked(getMatchDecisionsForSongs).mockResolvedValue(Result.ok([]));
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));
		vi.mocked(queries.insertQueueItems).mockResolvedValue(Result.ok(undefined));
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			activeSnapshotClient(["song-skipped"]),
		);

		const result = await syncActiveQueue(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(1);
		}
		expect(queries.insertQueueItems).toHaveBeenCalledWith([
			expect.objectContaining({
				sessionId: "session-fresh-sync",
				songId: "song-skipped",
			}),
		]);
	});
});

// ============================================================================
// appendSnapshotDelta — idempotency and filtering
// ============================================================================

describe("appendSnapshotDelta", () => {
	it("is a no-op when the snapshot was already applied", async () => {
		// Composite key (snapshotId:hash) must match for idempotency to trigger.
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set([SONG_APPLIED_KEY])),
		);

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.alreadyApplied).toBe(true);
			expect(result.value.appendedCount).toBe(0);
		}
		expect(queries.insertQueueItems).not.toHaveBeenCalled();
	});

	it("appends zero items and records snapshot when no match results exist", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(Result.ok([]));

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(0);
			expect(result.value.alreadyApplied).toBe(false);
		}
		// An empty-but-successful derivation must still record the (snapshot, hash)
		// pair so a later re-sync with the same hash is a no-op.
		expect(queries.insertSessionSnapshot).toHaveBeenCalledWith(
			SESSION_ID,
			SNAPSHOT_ID,
			0,
			SONG_VISIBILITY_HASH,
		);
	});

	it("excludes songs below the stored strictness threshold", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-ok",
					playlist_id: "pl-A",
					score: 0.8,
					fused_score: null,
				},
				{
					song_id: "song-low",
					playlist_id: "pl-B",
					score: 0.3,
					fused_score: null,
				}, // below 0.5
			]),
		);
		// Entitlement: both entitled
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-ok" }, { song_id: "song-low" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));
		vi.mocked(queries.insertQueueItems).mockResolvedValue(Result.ok(undefined));

		const result = await appendSnapshotDelta(
			fakeSession(), // strictnessMinScore: 0.5
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		// song-low (score 0.3) is filtered before insertQueueItems — only song-ok reaches insert
		const inserted = vi.mocked(queries.insertQueueItems).mock.calls[0]?.[0];
		expect(inserted?.every((item) => item.songId !== "song-low")).toBe(true);
	});

	it("excludes songs already in the active queue (fetchQueuedSongIds filter)", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-already-queued",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
				{
					song_id: "song-new",
					playlist_id: "pl-B",
					score: 0.8,
					fused_score: null,
				},
			]),
		);
		// Both songs are entitled
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-already-queued" }, { song_id: "song-new" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		// song-already-queued is already in the session queue
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set(["song-already-queued"])),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(4));
		vi.mocked(queries.insertQueueItems).mockResolvedValue(Result.ok(undefined));

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		const inserted = vi.mocked(queries.insertQueueItems).mock.calls[0]?.[0];
		// Only song-new should be inserted; song-already-queued is excluded
		expect(inserted).toHaveLength(1);
		expect(inserted?.[0]?.songId).toBe("song-new");
		// Position appended at max(4)+1 = 5
		expect(inserted?.[0]?.position).toBe(5);
	});

	it("excludes songs already decided at all above-threshold playlist pairs", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-decided",
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
					song_id: "song-decided",
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
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-decided" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(0);
		}
		expect(queries.insertQueueItems).not.toHaveBeenCalled();
	});

	it("excludes non-entitled songs (entitlement RPC returns empty set)", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
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
		// Entitlement RPC returns empty — song-1 is not entitled
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(0);
		}
	});

	it("treats a ConstraintError from insertQueueItems as a safe no-op (concurrent position collision)", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-x",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-x" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));
		// Concurrent append already populated positions — position-uniqueness collision
		vi.mocked(queries.insertQueueItems).mockResolvedValue(
			Result.err(
				new ConstraintError(
					"match_review_queue_item_session_id_position_key",
					"Key (session_id, position)=(session-test-001, 0) already exists",
				),
			),
		);

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		// Must succeed — no crash — concurrent winner already populated the queue
		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(0);
			expect(result.value.alreadyApplied).toBe(true);
		}
	});

	it("returns a DB error and does NOT record the snapshot when the entitlement RPC fails", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
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
		// Entitlement RPC errors. Reading this as an empty entitled set would derive
		// zero items and then mark the snapshot applied — permanently skipping every
		// valid match. It must surface as a DB error instead.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: null,
				error: { code: "57014", message: "rpc timeout" },
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeErr();
		// Critically: the snapshot must NOT be recorded as applied on RPC failure.
		expect(queries.insertSessionSnapshot).not.toHaveBeenCalled();
		expect(queries.insertQueueItems).not.toHaveBeenCalled();
	});

	it("treats a duplicate snapshot-row ConstraintError as a successful idempotent append", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-x",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-x" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));
		vi.mocked(queries.insertQueueItems).mockResolvedValue(Result.ok(undefined));
		// Items inserted, but recording the snapshot row races with a concurrent
		// call → composite-PK ConstraintError. That is a benign idempotency no-op.
		vi.mocked(queries.insertSessionSnapshot).mockResolvedValue(
			Result.err(new ConstraintError("match_review_session_snapshot_pkey")),
		);

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		// The append still reports the items it inserted, not an error.
		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(1);
			expect(result.value.alreadyApplied).toBe(false);
		}
	});

	it("appends newly-visible subjects when read-time filters are loosened (different hash bypasses idempotency guard)", async () => {
		// Pre-condition: this snapshot was already applied under STRICT filters that
		// excluded "song-newly-visible". The strict composite key is in appliedIds.
		// After loosening, the new composite key (same snapshot + loosened hash) is
		// absent → idempotency guard does NOT short-circuit → newly-visible subject
		// is appended; already-queued subject is excluded by fetchQueuedSongIds.
		// This test fails if: (a) idempotency guard ignores the hash component,
		// (b) hash is insensitive to filter changes, or (c) fetchQueuedSongIds
		// exclusion is removed (would produce appendedCount=2 instead of 1).
		const strictFilters = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-A", { version: 1, languages: { codes: ["en"] } }],
		]);
		const loosenedFilters = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-A", null],
		]);

		const session = fakeSession(); // orientation='song', minScore=0.5

		const strictReadTimeHash = computeReadTimeFiltersHash(strictFilters);
		const loosenedReadTimeHash = computeReadTimeFiltersHash(loosenedFilters);

		const strictVisHash = computeVisibilityConfigHash({
			orientation: session.orientation,
			minScore: session.strictnessMinScore,
			readTimeFiltersHash: strictReadTimeHash,
		});
		const loosenedVisHash = computeVisibilityConfigHash({
			orientation: session.orientation,
			minScore: session.strictnessMinScore,
			readTimeFiltersHash: loosenedReadTimeHash,
		});

		// The two hashes must differ — otherwise this test proves nothing.
		expect(strictVisHash).not.toBe(loosenedVisHash);

		// The session already recorded the strict hash as applied.
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set([`${SNAPSHOT_ID}:${strictVisHash}`])),
		);

		// Filters have since been loosened.
		vi.mocked(queries.fetchTargetPlaylistFilters).mockResolvedValue(
			Result.ok(loosenedFilters),
		);

		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-already-queued",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
				{
					song_id: "song-newly-visible",
					playlist_id: "pl-A",
					score: 0.8,
					fused_score: null,
				},
			]),
		);

		// Both songs are entitled.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [
					{ song_id: "song-already-queued" },
					{ song_id: "song-newly-visible" },
				],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		// "song-already-queued" was inserted during the strict pass and must not be duplicated.
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set(["song-already-queued"])),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(0));
		vi.mocked(queries.insertQueueItems).mockResolvedValue(Result.ok(undefined));

		const result = await appendSnapshotDelta(session, SNAPSHOT_ID, ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(1);
			expect(result.value.alreadyApplied).toBe(false);
		}

		// Only "song-newly-visible" is inserted; the already-queued song is excluded.
		const inserted = vi.mocked(queries.insertQueueItems).mock.calls[0]?.[0];
		expect(inserted).toHaveLength(1);
		expect(inserted?.[0]?.songId).toBe("song-newly-visible");
		expect(inserted?.[0]?.position).toBe(1); // appended at max(0)+1

		// The loosened hash (not the strict hash) is recorded as the new applied key.
		expect(queries.insertSessionSnapshot).toHaveBeenCalledWith(
			SESSION_ID,
			SNAPSHOT_ID,
			1,
			loosenedVisHash,
		);
	});
});

// ============================================================================
// appendSnapshotDelta — analytics events (Phase 9)
// ============================================================================

describe("appendSnapshotDelta — analytics events", () => {
	it("invokes onVisibleAppend with correct info on a non-zero append", async () => {
		// One entitled song above threshold, not yet queued — guarantees appendedCount=1.
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-evt",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-evt" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));

		const onVisibleAppend = vi.fn();
		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
			{ onVisibleAppend },
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(1);
		}

		expect(onVisibleAppend).toHaveBeenCalledOnce();
		expect(onVisibleAppend).toHaveBeenCalledWith({
			orientation: "song",
			appendedCount: 1,
			accountId: ACCOUNT_ID,
		});
	});

	it("does not invoke onVisibleAppend when appendedCount is zero", async () => {
		// Default getMatchResults returns [] — no items can be appended.
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);

		const onVisibleAppend = vi.fn();
		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
			{ onVisibleAppend },
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(0);
		}

		expect(onVisibleAppend).not.toHaveBeenCalled();
	});
});

// ============================================================================
// appendSnapshotDelta — visibility policy filters (M1: filters at queue-build)
// ============================================================================

describe("appendSnapshotDelta — policy filters", () => {
	const meta = (language: string | null): SongFilterMetadata => ({
		language,
		languageSecondary: null,
		releaseYear: null,
		vocalGender: null,
		likedAt: null,
	});

	const enFilter = (): Map<string, PlaylistMatchFiltersV1 | null> =>
		new Map([["pl-A", { version: 1, languages: { codes: ["en"] } }]]);

	function entitledClient(songIds: string[]) {
		return {
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: songIds.map((song_id) => ({ song_id })),
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>;
	}

	it("song mode: does not queue a song whose only strictness-passing pair is hidden by playlist filters", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(queries.fetchTargetPlaylistFilters).mockResolvedValue(
			Result.ok(enFilter()),
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
		// French song fails pl-A's English filter, so its only pair is hidden.
		vi.mocked(fetchSongsFilterMeta).mockResolvedValue(
			Result.ok(new Map([["song-fr", meta("fr")]])),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			entitledClient(["song-fr"]),
		);
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.appendedCount).toBe(0);
		expect(queries.insertQueueItems).not.toHaveBeenCalled();
	});

	it("song mode: queues a song with one filter-hidden pair and one visible pair, using the visible pair's score", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		// pl-A filters to English; pl-B has no filter.
		vi.mocked(queries.fetchTargetPlaylistFilters).mockResolvedValue(
			Result.ok(
				new Map<string, PlaylistMatchFiltersV1 | null>([
					["pl-A", { version: 1, languages: { codes: ["en"] } }],
					["pl-B", null],
				]),
			),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				// Higher-scoring pair is filter-hidden; the visible pair scores lower.
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.95,
					fused_score: null,
				},
				{
					song_id: "song-1",
					playlist_id: "pl-B",
					score: 0.7,
					fused_score: null,
				},
			]),
		);
		vi.mocked(fetchSongsFilterMeta).mockResolvedValue(
			Result.ok(new Map([["song-1", meta("fr")]])),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			entitledClient(["song-1"]),
		);
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		const inserted = vi.mocked(queries.insertQueueItems).mock.calls[0]?.[0];
		expect(inserted).toHaveLength(1);
		expect(inserted?.[0]?.songId).toBe("song-1");
		// The source score is the visible pl-B pair (0.7), not the hidden pl-A (0.95).
		expect(inserted?.[0]?.sourceScore).toBeCloseTo(0.7);
	});

	it("song mode: does not queue a song whose only policy-passing pair points to a non-owned playlist", async () => {
		// Finding 2: the card drops suggestion playlists the account no longer owns,
		// so a song whose every visible pair targets a non-owned playlist would render
		// an empty card. Queue derivation must apply the same ownership constraint.
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
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
		vi.mocked(queries.fetchQueuedSongIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		// pl-gone was deleted/transferred since the snapshot — not owned anymore.
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);

		const result = await appendSnapshotDelta(
			fakeSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.appendedCount).toBe(0);
		expect(queries.insertQueueItems).not.toHaveBeenCalled();
	});

	it("playlist mode: does not queue a playlist whose only entitled suggestion songs are filter-hidden", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(queries.fetchTargetPlaylistFilters).mockResolvedValue(
			Result.ok(enFilter()),
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
			Result.ok(new Map([["song-fr", meta("fr")]])),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			entitledClient(["song-fr"]),
		);
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set(["pl-A"])),
		);

		const result = await appendSnapshotDelta(
			fakePlaylistSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.appendedCount).toBe(0);
		expect(queries.insertQueuePlaylistItems).not.toHaveBeenCalled();
	});

	it("playlist mode: entitledVisiblePlaylistIds respects filters (a filter-hidden song does not make a playlist visible)", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		// Both playlists filter to English; pl-A's song is English, pl-B's is French.
		vi.mocked(queries.fetchTargetPlaylistFilters).mockResolvedValue(
			Result.ok(
				new Map<string, PlaylistMatchFiltersV1 | null>([
					["pl-A", { version: 1, languages: { codes: ["en"] } }],
					["pl-B", { version: 1, languages: { codes: ["en"] } }],
				]),
			),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-en",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
				{
					song_id: "song-fr",
					playlist_id: "pl-B",
					score: 0.9,
					fused_score: null,
				},
			]),
		);
		vi.mocked(fetchSongsFilterMeta).mockResolvedValue(
			Result.ok(
				new Map([
					["song-en", meta("en")],
					["song-fr", meta("fr")],
				]),
			),
		);
		// Both songs are entitled — only the filter distinguishes them.
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			entitledClient(["song-en", "song-fr"]),
		);
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set(["pl-A", "pl-B"])),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));

		const result = await appendSnapshotDelta(
			fakePlaylistSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		const inserted = vi.mocked(queries.insertQueuePlaylistItems).mock
			.calls[0]?.[0];
		// pl-B's only entitled song is filter-hidden, so only pl-A is queued.
		expect(inserted?.map((i) => i.playlistId)).toEqual(["pl-A"]);
	});
});

// ============================================================================
// appendSnapshotDelta — playlist orientation (Finding 1)
// ============================================================================

const PLAYLIST_VISIBILITY_HASH = computeVisibilityConfigHash({
	orientation: "playlist",
	minScore: 0.5,
	readTimeFiltersHash: computeReadTimeFiltersHash(new Map()),
});

function fakePlaylistSession() {
	return { ...fakeSession(), orientation: "playlist" as const };
}

describe("appendSnapshotDelta — playlist orientation", () => {
	it("inserts playlist queue items for owned playlists with entitled visible song matches", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
				{
					song_id: "song-2",
					playlist_id: "pl-B",
					score: 0.8,
					fused_score: null,
				},
			]),
		);
		// Both songs entitled (entitlement RPC returns the song set).
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-1" }, { song_id: "song-2" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		// Both review playlists are still owned by the account.
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set(["pl-A", "pl-B"])),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));

		const result = await appendSnapshotDelta(
			fakePlaylistSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.appendedCount).toBe(2);
		// Song-mode insert path is never used for a playlist session.
		expect(queries.insertQueueItems).not.toHaveBeenCalled();
		const inserted = vi.mocked(queries.insertQueuePlaylistItems).mock
			.calls[0]?.[0];
		expect(inserted?.map((i) => i.playlistId).toSorted()).toEqual([
			"pl-A",
			"pl-B",
		]);
		// Playlist rows carry the playlist subject and no newness flag.
		expect(inserted?.every((i) => i.wasNewAtEnqueue === false)).toBe(true);
		expect(inserted?.[0]?.position).toBe(0);
	});

	it("excludes playlists whose only visible song matches are not entitled", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
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
		// Entitlement RPC returns empty — song-1 is not entitled, so pl-A has no
		// actionable visible song and must not be enqueued.
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set(["pl-A"])),
		);

		const result = await appendSnapshotDelta(
			fakePlaylistSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.appendedCount).toBe(0);
		expect(queries.insertQueuePlaylistItems).not.toHaveBeenCalled();
		// The snapshot is still recorded so re-sync is a no-op.
		expect(queries.insertSessionSnapshot).toHaveBeenCalledWith(
			SESSION_ID,
			SNAPSHOT_ID,
			0,
			PLAYLIST_VISIBILITY_HASH,
		);
	});

	it("excludes playlists no longer owned by the account", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
				{
					song_id: "song-2",
					playlist_id: "pl-B",
					score: 0.8,
					fused_score: null,
				},
			]),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-1" }, { song_id: "song-2" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		// pl-B was transferred/deleted — only pl-A remains owned.
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set(["pl-A"])),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));

		const result = await appendSnapshotDelta(
			fakePlaylistSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		const inserted = vi.mocked(queries.insertQueuePlaylistItems).mock
			.calls[0]?.[0];
		expect(inserted?.map((i) => i.playlistId)).toEqual(["pl-A"]);
	});

	it("excludes playlists already in the active queue", async () => {
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set<string>()),
		);
		vi.mocked(getMatchResults).mockResolvedValue(
			Result.ok([
				{
					song_id: "song-1",
					playlist_id: "pl-A",
					score: 0.9,
					fused_score: null,
				},
				{
					song_id: "song-2",
					playlist_id: "pl-B",
					score: 0.8,
					fused_score: null,
				},
			]),
		);
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from: vi.fn().mockReturnThis(),
			rpc: vi.fn().mockResolvedValue({
				data: [{ song_id: "song-1" }, { song_id: "song-2" }],
				error: null,
			}),
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);
		vi.mocked(queries.fetchOwnedPlaylistIds).mockResolvedValue(
			Result.ok(new Set(["pl-A", "pl-B"])),
		);
		// pl-A is already enqueued — only pl-B is new.
		vi.mocked(queries.fetchQueuedPlaylistIds).mockResolvedValue(
			Result.ok(new Set(["pl-A"])),
		);
		vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(4));

		const result = await appendSnapshotDelta(
			fakePlaylistSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		const inserted = vi.mocked(queries.insertQueuePlaylistItems).mock
			.calls[0]?.[0];
		expect(inserted).toHaveLength(1);
		expect(inserted?.[0]?.playlistId).toBe("pl-B");
		expect(inserted?.[0]?.position).toBe(5);
	});

	it("is idempotent — a re-sync of the same snapshot/hash appends nothing", async () => {
		const appliedKey = `${SNAPSHOT_ID}:${PLAYLIST_VISIBILITY_HASH}`;
		vi.mocked(queries.fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set([appliedKey])),
		);

		const result = await appendSnapshotDelta(
			fakePlaylistSession(),
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.appendedCount).toBe(0);
			expect(result.value.alreadyApplied).toBe(true);
		}
		expect(queries.insertQueuePlaylistItems).not.toHaveBeenCalled();
	});
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
// markItemPresented
// ============================================================================

describe("markItemPresented", () => {
	it("updates state to active and records presented_at", async () => {
		const presentedItem = fakeQueueItem({
			state: "active",
			presentedAt: "2026-06-15T00:00:00Z",
		});
		vi.mocked(queries.updateQueueItemPresented).mockResolvedValue(
			Result.ok(presentedItem),
		);

		const result = await markItemPresented("item-001", ACCOUNT_ID, "song-001");

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value?.state).toBe("active");
		}
	});

	it("clears newness with the account id, song id, and a timestamp on success", async () => {
		// The positive path: a successful presented transition must durably clear the
		// song's newness so it never re-flags after the user has seen the card.
		vi.mocked(queries.updateQueueItemPresented).mockResolvedValue(
			Result.ok(fakeQueueItem({ state: "active" })),
		);

		await markItemPresented("item-001", ACCOUNT_ID, "song-001");

		expect(queries.clearSongNewness).toHaveBeenCalledWith(
			ACCOUNT_ID,
			"song-001",
			expect.any(String),
		);
	});

	it("still resolves the presented transition when clearSongNewness rejects", async () => {
		// Newness clearing is best-effort: a failure there must not fail the presented
		// transition (the item is presented regardless). The await-in-try/catch keeps
		// the write reliable in serverless while still swallowing the error.
		vi.mocked(queries.updateQueueItemPresented).mockResolvedValue(
			Result.ok(fakeQueueItem({ state: "active" })),
		);
		vi.mocked(queries.clearSongNewness).mockRejectedValue(
			new Error("newness write failed"),
		);

		const result = await markItemPresented("item-001", ACCOUNT_ID, "song-001");

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value?.state).toBe("active");
		}
	});

	it("returns ok(null) and does NOT clear newness when no eligible row was updated", async () => {
		// The conditional update matched no row (item already resolved/raced), so a
		// resolved card is not resurrected and its song's newness must be left alone.
		vi.mocked(queries.updateQueueItemPresented).mockResolvedValue(
			Result.ok(null),
		);

		const result = await markItemPresented("item-001", ACCOUNT_ID, "song-001");

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toBeNull();
		}
		expect(queries.clearSongNewness).not.toHaveBeenCalled();
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
