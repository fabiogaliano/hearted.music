/**
 * MSR-17 — write-match-snapshot rankings payload tests.
 *
 * Covers:
 *   - Rankings array nested in p_results reaches publish_match_snapshot RPC.
 *   - Legacy result entries without rankings still publish (D1 compat).
 *   - Legacy score/rank mirror: whatever score/rank the caller passes is
 *     forwarded unchanged to the RPC (C12 contract lives in orchestrator).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
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
		snapshotHash: "hash-msr17",
		configHash: "cfg-msr17",
		playlistSetHash: "pls-msr17",
		candidateSetHash: "cnd-msr17",
	}),
}));

vi.mock("@/lib/domains/enrichment/embeddings/versioning", () => ({
	MATCHING_ALGO_VERSION: "msr17-v1",
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	markItemsNew: vi.fn().mockResolvedValue(undefined),
}));

const { writeMatchSnapshot } = await import("../write-match-snapshot");

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
		hasGenrePills: false,
	};
}

describe("writeMatchSnapshot — ranking payload (MSR-17)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRpc.mockResolvedValue({ data: "snap-msr17", error: null });
	});

	it("includes rankings array in p_results when entries carry ranking rows", async () => {
		await writeMatchSnapshot({
			accountId: "acc-1",
			songs: [makeSong("s1")],
			profiles: [makeProfile("p1")],
			results: [
				{
					song_id: "s1",
					playlist_id: "p1",
					score: 0.92,
					fused_score: 0.72,
					rank: 1,
					factors: { embedding: 0.9, audio: 0.5, genre: 0.3 },
					normalized_factors: { embedding: 0.81, audio: 0.44, genre: 0.27 },
					rankings: [
						{
							orientation: "song",
							rank: 1,
							ordering_score: 0.92,
							reranker_score: 0.85,
							source: "rerank",
							document_mode: "analysis",
						},
						{
							orientation: "playlist",
							rank: 2,
							ordering_score: 0.88,
							reranker_score: null,
							source: "fused_fallback",
							document_mode: "metadata",
						},
					],
				},
			],
			matchedSongIds: ["s1"],
		});

		expect(mockRpc).toHaveBeenCalledOnce();
		const rpcArgs = mockRpc.mock.calls[0][1] as { p_results: unknown[] };
		const firstResult = rpcArgs.p_results[0] as Record<string, unknown>;
		expect(Array.isArray(firstResult.rankings)).toBe(true);
		expect((firstResult.rankings as unknown[]).length).toBe(2);

		const rows = firstResult.rankings as Array<Record<string, unknown>>;
		const songRow = rows.find((r) => r.orientation === "song");
		expect(songRow?.rank).toBe(1);
		expect(songRow?.ordering_score).toBe(0.92);
		expect(songRow?.reranker_score).toBe(0.85);
		expect(songRow?.source).toBe("rerank");
		expect(songRow?.document_mode).toBe("analysis");

		const playlistRow = rows.find((r) => r.orientation === "playlist");
		expect(playlistRow?.rank).toBe(2);
		expect(playlistRow?.reranker_score).toBeNull();
		expect(playlistRow?.source).toBe("fused_fallback");
	});

	it("omits rankings key from p_results when no rankings are attached (D1 legacy compat)", async () => {
		await writeMatchSnapshot({
			accountId: "acc-1",
			songs: [makeSong("s1")],
			profiles: [makeProfile("p1")],
			results: [
				{
					song_id: "s1",
					playlist_id: "p1",
					score: 0.8,
					fused_score: 0.72,
					rank: 1,
					factors: { embedding: 0.9, audio: 0.5, genre: 0.3 },
					normalized_factors: { embedding: 0.81, audio: 0.44, genre: 0.27 },
				},
			],
			matchedSongIds: ["s1"],
		});

		const rpcArgs = mockRpc.mock.calls[0][1] as { p_results: unknown[] };
		const firstResult = rpcArgs.p_results[0] as Record<string, unknown>;
		// The rankings key must be absent so the SQL COALESCE path fires (D1).
		expect(Object.hasOwn(firstResult, "rankings")).toBe(false);
	});

	it("publishes successfully when result entries have no rankings (legacy path)", async () => {
		const result = await writeMatchSnapshot({
			accountId: "acc-1",
			songs: [makeSong("s1")],
			profiles: [makeProfile("p1")],
			results: [
				{
					song_id: "s1",
					playlist_id: "p1",
					score: 0.8,
					fused_score: 0.72,
					rank: 1,
					factors: { embedding: 0.9, audio: 0.5, genre: 0.3 },
					normalized_factors: { embedding: 0.81, audio: 0.44, genre: 0.27 },
				},
			],
			matchedSongIds: ["s1"],
		});

		expect(result.published).toBe(true);
		expect(result.snapshotId).toBe("snap-msr17");
	});

	it("score and rank in p_results reflect whatever the caller passes (C12 mirror lives in orchestrator)", async () => {
		await writeMatchSnapshot({
			accountId: "acc-1",
			songs: [makeSong("s1")],
			profiles: [makeProfile("p1")],
			results: [
				{
					song_id: "s1",
					playlist_id: "p1",
					// Simulates song-orientation ordering_score=0.87, rank=2 being
					// mirrored into score/rank by the orchestrator (C12).
					score: 0.87,
					fused_score: 0.72,
					rank: 2,
					factors: { embedding: 0.9, audio: 0.5, genre: 0.3 },
					normalized_factors: { embedding: 0.81, audio: 0.44, genre: 0.27 },
					rankings: [
						{
							orientation: "song",
							rank: 2,
							ordering_score: 0.87,
							reranker_score: 0.79,
							source: "rerank",
							document_mode: "metadata",
						},
					],
				},
			],
			matchedSongIds: ["s1"],
		});

		const rpcArgs = mockRpc.mock.calls[0][1] as { p_results: unknown[] };
		const firstResult = rpcArgs.p_results[0] as Record<string, unknown>;
		expect(firstResult.score).toBe(0.87);
		expect(firstResult.rank).toBe(2);
	});
});
