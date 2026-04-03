import { describe, expect, it, vi, beforeEach } from "vitest";
import type {
	MatchingPlaylistProfile,
	MatchingSong,
} from "@/lib/domains/taste/song-matching/types";

const mockRpc = vi.fn();
vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ rpc: mockRpc }),
}));

vi.mock("@/lib/domains/taste/song-matching/cache", () => ({
	computeMatchSnapshotMetadata: vi.fn().mockResolvedValue({
		snapshotHash: "hash-abc",
		configHash: "cfg-1",
		playlistSetHash: "pls-1",
		candidateSetHash: "cnd-1",
	}),
}));

vi.mock("@/lib/domains/enrichment/embeddings/versioning", () => ({
	MATCHING_ALGO_VERSION: "test-v1",
}));

const mockMarkItemsNew = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	markItemsNew: (...args: unknown[]) => mockMarkItemsNew(...args),
}));

const { writeMatchSnapshot, writeEmptySnapshot } = await import(
	"../write-match-snapshot"
);

function makeSong(id: string): MatchingSong {
	return {
		id,
		spotifyId: `sp-${id}`,
		name: `Song ${id}`,
		artists: ["Artist"],
		genres: ["pop"],
		audioFeatures: null,
	};
}

function makeProfile(playlistId: string): MatchingPlaylistProfile {
	return {
		playlistId,
		embedding: [0.1, 0.2],
		audioCentroid: { energy: 0.5 },
		genreDistribution: { pop: 1.0 },
	};
}

describe("writeMatchSnapshot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("publishes snapshot and marks matched songs as new", async () => {
		mockRpc.mockResolvedValue({ data: "ctx-123", error: null });

		const result = await writeMatchSnapshot({
			accountId: "acc-1",
			songs: [makeSong("s1"), makeSong("s2")],
			profiles: [makeProfile("p1")],
			results: [
				{ song_id: "s1", playlist_id: "p1", score: 0.8, rank: 1, factors: {} },
			],
			matchedSongIds: ["s1"],
		});

		expect(result.published).toBe(true);
		expect(result.snapshotId).toBe("ctx-123");
		expect(result.matchedSongCount).toBe(1);
		expect(result.candidateCount).toBe(2);
		expect(result.playlistCount).toBe(1);
		expect(result.noOp).toBe(false);
		expect(mockMarkItemsNew).toHaveBeenCalledWith("acc-1", "song", ["s1"]);
	});

	it("returns no-op when snapshotHash matches latest (RPC returns null)", async () => {
		mockRpc.mockResolvedValue({ data: null, error: null });

		const result = await writeMatchSnapshot({
			accountId: "acc-1",
			songs: [makeSong("s1")],
			profiles: [makeProfile("p1")],
			results: [],
			matchedSongIds: [],
		});

		expect(result.published).toBe(false);
		expect(result.noOp).toBe(true);
		expect(result.snapshotId).toBeNull();
		expect(mockMarkItemsNew).not.toHaveBeenCalled();
	});

	it("does not mark items new when zero songs matched", async () => {
		mockRpc.mockResolvedValue({ data: "ctx-456", error: null });

		await writeMatchSnapshot({
			accountId: "acc-1",
			songs: [makeSong("s1")],
			profiles: [makeProfile("p1")],
			results: [],
			matchedSongIds: [],
		});

		expect(mockMarkItemsNew).not.toHaveBeenCalled();
	});

	it("throws on RPC error", async () => {
		mockRpc.mockResolvedValue({
			data: null,
			error: { message: "db down" },
		});

		await expect(
			writeMatchSnapshot({
				accountId: "acc-1",
				songs: [],
				profiles: [],
				results: [],
				matchedSongIds: [],
			}),
		).rejects.toThrow("Snapshot publish failed");
	});
});

describe("writeEmptySnapshot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("publishes explicit empty snapshot with stable hash", async () => {
		mockRpc.mockResolvedValue({ data: "ctx-empty", error: null });

		const result = await writeEmptySnapshot("acc-1");

		expect(result.published).toBe(true);
		expect(result.isEmpty).toBe(true);
		expect(result.matchedSongCount).toBe(0);
		expect(result.playlistCount).toBe(0);
		expect(result.candidateCount).toBe(0);

		expect(mockRpc).toHaveBeenCalledWith(
			"publish_match_snapshot",
			expect.objectContaining({
				p_snapshot_hash: "empty_target_playlist_snapshot",
				p_playlist_count: 0,
				p_song_count: 0,
				p_results: [],
			}),
		);
	});

	it("returns no-op for repeated empty snapshot", async () => {
		mockRpc.mockResolvedValue({ data: null, error: null });

		const result = await writeEmptySnapshot("acc-1");

		expect(result.published).toBe(false);
		expect(result.isEmpty).toBe(true);
		expect(result.noOp).toBe(true);
	});
});
