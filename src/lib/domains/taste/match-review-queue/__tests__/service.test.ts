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
import {
	deriveUndecidedSongsForQueue,
	getOrderedUndecidedSubjects,
} from "../service";
import type { MatchReviewQueueItem } from "../types";

// ============================================================================
// Pure derivation tests — no mocks needed
// ============================================================================

describe("deriveUndecidedSongsForQueue", () => {
	const mr = (
		song_id: string,
		playlist_id: string,
		score: number,
		fused_score: number | null = null,
	) => ({
		song_id,
		playlist_id,
		score,
		fused_score,
	});

	it("returns empty when no match results", () => {
		const result = deriveUndecidedSongsForQueue([], new Set(), 0.5, new Set());
		expect(result).toEqual([]);
	});

	it("includes songs with at least one undecided match above the threshold", () => {
		const results = [mr("song-1", "pl-A", 0.7), mr("song-2", "pl-B", 0.6)];
		const derived = deriveUndecidedSongsForQueue(
			results,
			new Set(),
			0.5,
			new Set(),
		);
		expect(derived.map((s) => s.songId)).toContain("song-1");
		expect(derived.map((s) => s.songId)).toContain("song-2");
	});

	it("excludes songs whose only matches are below the strictness threshold", () => {
		const results = [
			mr("song-below", "pl-A", 0.3), // below 0.5 bar
			mr("song-above", "pl-B", 0.6),
		];
		const derived = deriveUndecidedSongsForQueue(
			results,
			new Set(),
			0.5,
			new Set(),
		);
		expect(derived.map((s) => s.songId)).not.toContain("song-below");
		expect(derived.map((s) => s.songId)).toContain("song-above");
	});

	it("excludes songs where all above-threshold matches are already decided", () => {
		const results = [mr("song-1", "pl-A", 0.7), mr("song-1", "pl-B", 0.6)];
		// Both pairs decided
		const decided = new Set(["song-1:pl-A", "song-1:pl-B"]);
		const derived = deriveUndecidedSongsForQueue(
			results,
			decided,
			0.5,
			new Set(),
		);
		expect(derived).toHaveLength(0);
	});

	it("keeps a song when at least one of its playlist pairs is undecided", () => {
		const results = [
			mr("song-1", "pl-A", 0.7), // decided
			mr("song-1", "pl-B", 0.6), // undecided
		];
		const decided = new Set(["song-1:pl-A"]);
		const derived = deriveUndecidedSongsForQueue(
			results,
			decided,
			0.5,
			new Set(),
		);
		expect(derived).toHaveLength(1);
		expect(derived[0].songId).toBe("song-1");
	});

	it("records the max visible score as sourceScore", () => {
		const results = [mr("song-1", "pl-A", 0.9), mr("song-1", "pl-B", 0.6)];
		const derived = deriveUndecidedSongsForQueue(
			results,
			new Set(),
			0.5,
			new Set(),
		);
		expect(derived[0].maxScore).toBeCloseTo(0.9);
	});

	it("marks isNew=true only for songs in the newness set", () => {
		const results = [mr("song-new", "pl-A", 0.8), mr("song-old", "pl-B", 0.7)];
		const newSet = new Set(["song-new"]);
		const derived = deriveUndecidedSongsForQueue(
			results,
			new Set(),
			0.5,
			newSet,
		);
		const newSong = derived.find((s) => s.songId === "song-new");
		const oldSong = derived.find((s) => s.songId === "song-old");
		expect(newSong?.isNew).toBe(true);
		expect(oldSong?.isNew).toBe(false);
	});
});

// ============================================================================
// Ordering policy — tested against the pure sort
// ============================================================================

// Import the unexported sort helper by going through the derived output
// ordering. We test the full pipeline (derive + sort) via the service
// function exported for queue seeding.

describe("queue ordering (new first, max score desc, id asc)", () => {
	const mr = (
		song_id: string,
		playlist_id: string,
		score: number,
		fused_score: number | null = null,
	) => ({
		song_id,
		playlist_id,
		score,
		fused_score,
	});

	function deriveOrdered(
		matchResults: ReturnType<typeof mr>[],
		newIds: string[] = [],
	) {
		const newSet = new Set(newIds);
		// Call derive to get the unsorted candidates, then test order by sorting
		// ourselves the same way the service does in sortSongsForQueue.
		const candidates = deriveUndecidedSongsForQueue(
			matchResults,
			new Set(),
			0,
			newSet,
		);
		return candidates.toSorted((a, b) => {
			const aNew = a.isNew ? 1 : 0;
			const bNew = b.isNew ? 1 : 0;
			if (aNew !== bNew) return bNew - aNew;
			if (b.maxScore !== a.maxScore) return b.maxScore - a.maxScore;
			return a.songId.localeCompare(b.songId);
		});
	}

	it("new songs sort before non-new songs regardless of score", () => {
		const results = [
			mr("song-high-score", "pl-A", 0.99), // not new
			mr("song-new-low", "pl-B", 0.5), // new
		];
		const ordered = deriveOrdered(results, ["song-new-low"]);
		expect(ordered[0].songId).toBe("song-new-low");
	});

	it("within the same newness bucket, sorts by max score descending", () => {
		const results = [
			mr("song-low", "pl-A", 0.6),
			mr("song-high", "pl-B", 0.9),
			mr("song-mid", "pl-C", 0.75),
		];
		const ordered = deriveOrdered(results);
		expect(ordered.map((s) => s.songId)).toEqual([
			"song-high",
			"song-mid",
			"song-low",
		]);
	});

	it("breaks score ties by song id ascending", () => {
		const results = [
			mr("z-song", "pl-A", 0.8),
			mr("a-song", "pl-B", 0.8),
			mr("m-song", "pl-C", 0.8),
		];
		const ordered = deriveOrdered(results);
		expect(ordered.map((s) => s.songId)).toEqual([
			"a-song",
			"m-song",
			"z-song",
		]);
	});

	it("produces a deterministic 3-key sort: [new desc, score desc, id asc]", () => {
		const results = [
			mr("z-new", "pl-1", 0.5), // new, low score
			mr("a-old", "pl-2", 0.99), // not new, high score
			mr("b-new", "pl-3", 0.9), // new, high score
			mr("c-old", "pl-4", 0.7), // not new
		];
		const ordered = deriveOrdered(results, ["z-new", "b-new"]);
		// New first sorted by score desc then id asc: b-new(0.9), z-new(0.5)
		// Then non-new sorted by score desc: a-old(0.99), c-old(0.7)
		expect(ordered.map((s) => s.songId)).toEqual([
			"b-new",
			"z-new",
			"a-old",
			"c-old",
		]);
	});
});

// ============================================================================
// getOrderedUndecidedSubjects — orientation-aware derivation (MSR-19)
// ============================================================================

describe("getOrderedUndecidedSubjects — song mode", () => {
	const mr = (
		song_id: string,
		playlist_id: string,
		score: number,
		fused_score: number | null = null,
	) => ({ song_id, playlist_id, score, fused_score });

	it("returns song-orientation subjects with wasNewAtEnqueue from newness set", () => {
		const results = [mr("song-new", "pl-A", 0.9), mr("song-old", "pl-B", 0.8)];
		const { subjects } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.5,
			"song",
			new Set(["song-new"]),
		);
		const newSubject = subjects.find(
			(s) =>
				s.subject.orientation === "song" && s.subject.songId === "song-new",
		);
		const oldSubject = subjects.find(
			(s) =>
				s.subject.orientation === "song" && s.subject.songId === "song-old",
		);
		expect(newSubject?.wasNewAtEnqueue).toBe(true);
		expect(oldSubject?.wasNewAtEnqueue).toBe(false);
	});

	it("orders new songs before non-new regardless of score", () => {
		const results = [
			mr("song-high", "pl-A", 0.99), // not new
			mr("song-new-low", "pl-B", 0.5), // new
		];
		const { subjects } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.3,
			"song",
			new Set(["song-new-low"]),
		);
		expect(subjects[0]?.subject).toMatchObject({
			orientation: "song",
			songId: "song-new-low",
		});
	});

	it("counts hidden songs below threshold as hiddenReviewItemCount", () => {
		const results = [
			mr("song-visible", "pl-A", 0.8),
			mr("song-hidden", "pl-B", 0.3), // below 0.5 threshold
		];
		const { subjects, hiddenReviewItemCount } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.5,
			"song",
			new Set(),
		);
		expect(subjects).toHaveLength(1);
		expect(subjects[0]?.subject).toMatchObject({
			orientation: "song",
			songId: "song-visible",
		});
		expect(hiddenReviewItemCount).toBe(1);
	});

	it("returns hiddenReviewItemCount=0 when all undecided songs pass threshold", () => {
		const results = [mr("s1", "pl-A", 0.8), mr("s2", "pl-B", 0.7)];
		const { hiddenReviewItemCount } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.5,
			"song",
			new Set(),
		);
		expect(hiddenReviewItemCount).toBe(0);
	});
});

describe("getOrderedUndecidedSubjects — playlist mode", () => {
	const mr = (
		song_id: string,
		playlist_id: string,
		score: number,
		fused_score: number | null = null,
	) => ({ song_id, playlist_id, score, fused_score });

	it("returns playlist-orientation subjects", () => {
		const results = [mr("song-1", "pl-A", 0.8), mr("song-2", "pl-B", 0.7)];
		const { subjects } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.5,
			"playlist",
			new Set(),
		);
		expect(subjects.every((s) => s.subject.orientation === "playlist")).toBe(
			true,
		);
	});

	it("sets wasNewAtEnqueue=false for all playlist subjects", () => {
		// Playlists have no newness concept; the newSongIds parameter is ignored.
		const results = [mr("song-1", "pl-A", 0.9)];
		const { subjects } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.5,
			"playlist",
			new Set(["song-1"]), // newness set should have no effect
		);
		expect(subjects[0]?.wasNewAtEnqueue).toBe(false);
	});

	it("orders playlists by max score desc then playlist id asc (no newness tier)", () => {
		const results = [
			mr("song-1", "pl-low", 0.6),
			mr("song-2", "pl-high", 0.95),
			mr("song-3", "pl-mid", 0.8),
		];
		const { subjects } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.5,
			"playlist",
			new Set(),
		);
		const ids = subjects.map((s) =>
			s.subject.orientation === "playlist" ? s.subject.playlistId : "",
		);
		expect(ids).toEqual(["pl-high", "pl-mid", "pl-low"]);
	});

	it("breaks score ties by playlist id ascending", () => {
		const results = [
			mr("song-1", "pl-z", 0.8),
			mr("song-2", "pl-a", 0.8),
			mr("song-3", "pl-m", 0.8),
		];
		const { subjects } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.5,
			"playlist",
			new Set(),
		);
		const ids = subjects.map((s) =>
			s.subject.orientation === "playlist" ? s.subject.playlistId : "",
		);
		expect(ids).toEqual(["pl-a", "pl-m", "pl-z"]);
	});

	it("excludes playlists whose only songs are decided", () => {
		const results = [
			mr("song-1", "pl-decided", 0.8),
			mr("song-2", "pl-open", 0.7),
		];
		const decidedPairs = new Set(["song-1:pl-decided"]);
		const { subjects } = getOrderedUndecidedSubjects(
			results,
			decidedPairs,
			0.5,
			"playlist",
			new Set(),
		);
		const ids = subjects.map((s) =>
			s.subject.orientation === "playlist" ? s.subject.playlistId : "",
		);
		expect(ids).not.toContain("pl-decided");
		expect(ids).toContain("pl-open");
	});

	it("counts hidden playlists below threshold as hiddenReviewItemCount", () => {
		const results = [
			mr("song-1", "pl-visible", 0.8),
			mr("song-2", "pl-hidden", 0.3), // below 0.5
		];
		const { subjects, hiddenReviewItemCount } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.5,
			"playlist",
			new Set(),
		);
		expect(subjects).toHaveLength(1);
		expect(hiddenReviewItemCount).toBe(1);
	});

	it("takes max score across all songs for a playlist subject", () => {
		// pl-A has two songs: 0.6 and 0.9 — max score should be 0.9
		const results = [mr("song-1", "pl-A", 0.6), mr("song-2", "pl-A", 0.9)];
		const { subjects } = getOrderedUndecidedSubjects(
			results,
			new Set(),
			0.5,
			"playlist",
			new Set(),
		);
		expect(subjects).toHaveLength(1);
		expect(subjects[0]?.maxScore).toBeCloseTo(0.9);
	});
});

// ============================================================================
// computeReadTimeFiltersHash — pure hash derivation (MSR-36)
// ============================================================================

describe("computeReadTimeFiltersHash", () => {
	it("returns stable value for empty filter map", () => {
		const h1 = computeReadTimeFiltersHash(new Map());
		const h2 = computeReadTimeFiltersHash(new Map());
		expect(h1).toBe(h2);
	});

	it("starts with rtf_ prefix", () => {
		expect(computeReadTimeFiltersHash(new Map())).toMatch(/^rtf_/);
	});

	it("changes when a filter is added", () => {
		const noFilters = computeReadTimeFiltersHash(new Map());
		const withFilter = computeReadTimeFiltersHash(
			new Map<string, PlaylistMatchFiltersV1 | null>([
				["pl-1", { version: 1, languages: { codes: ["en"] } }],
			]),
		);
		expect(noFilters).not.toBe(withFilter);
	});

	it("is stable when filters are unchanged", () => {
		const m1 = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-a", { version: 1, languages: { codes: ["en"] } }],
			["pl-b", null],
		]);
		const m2 = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-a", { version: 1, languages: { codes: ["en"] } }],
			["pl-b", null],
		]);
		expect(computeReadTimeFiltersHash(m1)).toBe(computeReadTimeFiltersHash(m2));
	});

	it("is independent of Map insertion order", () => {
		const m1 = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-a", { version: 1 }],
			["pl-b", { version: 1, vocalGender: "female" }],
		]);
		const m2 = new Map<string, PlaylistMatchFiltersV1 | null>([
			["pl-b", { version: 1, vocalGender: "female" }],
			["pl-a", { version: 1 }],
		]);
		expect(computeReadTimeFiltersHash(m1)).toBe(computeReadTimeFiltersHash(m2));
	});
});

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
	fetchMaxPosition: vi.fn(),
	insertQueueItems: vi.fn(),
	insertSessionSnapshot: vi.fn(),
	countUnresolvedItems: vi.fn(),
	fetchPendingSongIds: vi.fn(),
	updateQueueItemPresented: vi.fn(),
	updateQueueItemResolved: vi.fn(),
	clearSongNewness: vi.fn(),
	fetchTargetPlaylistFilters: vi.fn(),
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

import { createAdminSupabaseClient } from "@/lib/data/client";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { getMatchDecisionsForSongs } from "@/lib/domains/taste/song-matching/decision-queries";
import { getMatchResults } from "@/lib/domains/taste/song-matching/queries";
import * as queries from "../queries";
// Import after mocks are set up
import {
	appendSnapshotDelta,
	computeReadTimeFiltersHash,
	computeVisibilityConfigHash,
	createOrResumeQueue,
	getQueueSummary,
	markItemPresented,
	markItemResolved,
	syncActiveQueue,
} from "../service";

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
	vi.mocked(queries.fetchMaxPosition).mockResolvedValue(Result.ok(-1));
	vi.mocked(queries.insertQueueItems).mockResolvedValue(Result.ok(undefined));
	vi.mocked(queries.insertSessionSnapshot).mockResolvedValue(
		Result.ok(fakeSnapshotRow()),
	);
	vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
	vi.mocked(queries.fetchPendingSongIds).mockResolvedValue(Result.ok([]));
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
			expect(result.value.previewSongIds).toEqual([]);
		}
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
