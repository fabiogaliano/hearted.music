/**
 * Match review queue service tests.
 *
 * The session queries and the visibility-inputs read are stubbed so each test
 * drives deterministic inputs without a live DB; what the loader returns for
 * real rows is pinned by visibility-inputs.integration.test.ts.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";

vi.mock("../queries", () => ({
	fetchActiveSession: vi.fn(),
	countUnresolvedItems: vi.fn(),
	fetchPendingSongIds: vi.fn(),
	fetchPendingPlaylistIds: vi.fn(),
}));

vi.mock("../visibility-inputs", () => ({
	loadVisibilityInputs: vi.fn(),
}));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));

vi.mock("@/lib/domains/library/accounts/preferences-queries", () => ({
	resolveMinMatchScore: vi.fn(async () => 0.5),
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	getNewItemIds: vi.fn(async () => Result.ok<string[], never>([])),
}));

import { createAdminSupabaseClient } from "@/lib/data/client";
import { resolveMinMatchScore } from "@/lib/domains/library/accounts/preferences-queries";
import { getNewItemIds } from "@/lib/domains/library/liked-songs/status-queries";
import type { SongFilterMetadata } from "@/lib/domains/taste/match-filters/predicates";
import type { MatchResultRow } from "@/lib/domains/taste/song-matching/queries";
import * as queries from "../queries";
import {
	getOrderedUndecidedPlaylistIds,
	getOrderedUndecidedSongIds,
	getQueueSummary,
	hasFirstVisibleReviewSubject,
} from "../service";
import {
	loadVisibilityInputs,
	type VisibilityInputs,
} from "../visibility-inputs";

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

const mr = (
	song_id: string,
	playlist_id: string,
	score: number,
	fused_score: number | null = null,
): MatchResultRow => ({ song_id, playlist_id, score, fused_score });

/**
 * Visibility inputs where every pair's song is entitled and playlist owned,
 * unless the test narrows those sets.
 */
function inputs(
	pairs: MatchResultRow[],
	overrides: Partial<VisibilityInputs> = {},
): VisibilityInputs {
	return {
		pairs,
		entitledSongIds: new Set(pairs.map((p) => p.song_id)),
		ownedPlaylistIds: new Set(pairs.map((p) => p.playlist_id)),
		decidedPairs: new Set(),
		songMetaBySongId: new Map(),
		filtersByPlaylistId: new Map(),
		playlistsById: new Map(),
		...overrides,
	};
}

function mockInputs(value: VisibilityInputs) {
	vi.mocked(loadVisibilityInputs).mockResolvedValue(Result.ok(value));
}

/** Supabase client whose latest-snapshot lookup answers `snapshot`. */
function snapshotClient(
	snapshot: { data: { id: string } | null; error: unknown } = {
		data: null,
		error: null,
	},
) {
	return {
		from: vi.fn(() => ({
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue(snapshot),
		})),
	} as unknown as ReturnType<typeof createAdminSupabaseClient>;
}

beforeEach(() => {
	vi.clearAllMocks();

	vi.mocked(resolveMinMatchScore).mockResolvedValue(0.5);
	vi.mocked(getNewItemIds).mockResolvedValue(Result.ok([]));
	mockInputs(inputs([]));

	vi.mocked(queries.fetchActiveSession).mockResolvedValue(Result.ok(null));
	vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
	vi.mocked(queries.fetchPendingSongIds).mockResolvedValue(Result.ok([]));
	vi.mocked(queries.fetchPendingPlaylistIds).mockResolvedValue(Result.ok([]));

	// Default: no snapshot.
	vi.mocked(createAdminSupabaseClient).mockReturnValue(snapshotClient());
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

describe("getOrderedUndecidedSongIds", () => {
	const songMeta = (language: string | null): SongFilterMetadata => ({
		language,
		languageSecondary: null,
		releaseYear: null,
		vocalGender: null,
		likedAt: null,
	});

	it("orders entitled, visible song subjects and returns them", async () => {
		mockInputs(inputs([mr("song-b", "pl-A", 0.7), mr("song-a", "pl-A", 0.9)]));

		const result = await getOrderedUndecidedSongIds(SNAPSHOT_ID, ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			// Higher score first (no newness), then the lower-scored song.
			expect(result.value.songIds).toEqual(["song-a", "song-b"]);
			expect(result.value.hiddenReviewItemCount).toBe(0);
		}
	});

	it("excludes a filter-hidden song and counts it as hidden (Finding 1)", async () => {
		mockInputs(
			inputs([mr("song-fr", "pl-A", 0.9)], {
				filtersByPlaylistId: new Map([
					["pl-A", { version: 1, languages: { codes: ["en"] } }],
				]),
				songMetaBySongId: new Map([["song-fr", songMeta("fr")]]),
			}),
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
		mockInputs(
			inputs([mr("song-1", "pl-gone", 0.9)], { ownedPlaylistIds: new Set() }),
		);

		const result = await getOrderedUndecidedSongIds(SNAPSHOT_ID, ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.songIds).toEqual([]);
			expect(result.value.hiddenReviewItemCount).toBe(0);
		}
	});

	it("surfaces a visibility-inputs DB error rather than a falsely-empty preview", async () => {
		vi.mocked(loadVisibilityInputs).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);

		const result = await getOrderedUndecidedSongIds(SNAPSHOT_ID, ACCOUNT_ID);

		expect(result).toBeErr();
	});
});

describe("getOrderedUndecidedPlaylistIds", () => {
	// Two entitled, undecided playlists: pl-visible clears the 0.5 bar, pl-hidden
	// sits below it. pl-hidden therefore drives the hidden count, pl-visible the
	// returned playlistIds.
	const twoPlaylists = [
		mr("song-visible", "pl-visible", 0.9),
		mr("song-hidden", "pl-hidden", 0.3),
	];

	it("counts a hidden playlist that is still owned", async () => {
		mockInputs(inputs(twoPlaylists));

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
		// pl-hidden was deleted/transferred — a stale snapshot still references it,
		// but it must not inflate the hidden count.
		mockInputs(
			inputs(twoPlaylists, { ownedPlaylistIds: new Set(["pl-visible"]) }),
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
	});

	it("surfaces a visibility-inputs DB error rather than a falsely-empty preview", async () => {
		vi.mocked(loadVisibilityInputs).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);

		const result = await getOrderedUndecidedPlaylistIds(
			SNAPSHOT_ID,
			ACCOUNT_ID,
		);

		expect(result).toBeErr();
	});

	it("does not let a non-entitled pair's score reorder playlists", async () => {
		// pl-A's only high score (0.99) comes from a non-entitled song; its only
		// entitled pair scores 0.60. pl-B has an entitled pair at 0.90. The queue,
		// which orders off eligible pairs, ranks pl-B before pl-A — the preview must
		// match, never letting pl-A's locked 0.99 pull it to the front.
		mockInputs(
			inputs(
				[
					mr("locked", "pl-A", 0.99),
					mr("entitled-a", "pl-A", 0.6),
					mr("entitled-b", "pl-B", 0.9),
				],
				{ entitledSongIds: new Set(["entitled-a", "entitled-b"]) },
			),
		);

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
	beforeEach(() => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			snapshotClient({ data: { id: SNAPSHOT_ID }, error: null }),
		);
	});

	it("returns false when the snapshot's only pair is below the balanced strictness threshold (fused_score 0.49)", async () => {
		mockInputs(inputs([mr("song-1", "pl-A", 0.49, 0.49)]));

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
	});

	it("returns true when the snapshot has a visible undecided pair at fused_score 0.50", async () => {
		mockInputs(inputs([mr("song-1", "pl-A", 0.5, 0.5)]));

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(true);
	});

	it("returns false when the only above-threshold pair has already been decided", async () => {
		mockInputs(
			inputs([mr("song-1", "pl-A", 0.8)], {
				decidedPairs: new Set(["song-1:pl-A"]),
			}),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
	});

	it("returns false when the only pair is hidden by playlist filters", async () => {
		// pl-A filters to English only; this French song fails it.
		mockInputs(
			inputs([mr("song-fr", "pl-A", 0.9)], {
				filtersByPlaylistId: new Map([
					["pl-A", { version: 1, languages: { codes: ["en"] } }],
				]),
				songMetaBySongId: new Map([
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
			}),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
	});

	it("returns false when the only song in the snapshot is not entitled", async () => {
		mockInputs(
			inputs([mr("song-1", "pl-A", 0.8)], { entitledSongIds: new Set() }),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
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
		// The snapshot's inputs are never read — the queue summary short-circuited.
		expect(loadVisibilityInputs).not.toHaveBeenCalled();
	});

	it("returns false when there is no snapshot and no active queue", async () => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue(snapshotClient());

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBe(false);
	});

	it("propagates a DB error from the snapshot lookup rather than collapsing it to false", async () => {
		vi.mocked(createAdminSupabaseClient).mockReturnValue(
			snapshotClient({
				data: null,
				error: { code: "08006", message: "conn lost" },
			}),
		);

		const result = await hasFirstVisibleReviewSubject(ACCOUNT_ID);

		expect(result).toBeErr();
	});
});
