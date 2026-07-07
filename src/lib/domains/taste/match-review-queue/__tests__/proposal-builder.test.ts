import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables } from "@/lib/data/database.types";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import { deriveProposalSubjects } from "../eligible-subjects";
import { buildOneProposal } from "../proposal-builder";

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: vi.fn(),
}));
vi.mock("../eligible-subjects", () => ({
	deriveProposalSubjects: vi.fn(),
}));

const SNAPSHOT_ROW: Tables<"match_snapshot"> = {
	id: "snap-1",
	account_id: "acct-1",
	algorithm_version: "v1",
	analysis_model: null,
	analysis_version: null,
	candidate_set_hash: "cand",
	config_hash: "cfg",
	created_at: "2026-07-07T00:00:00Z",
	embedding_model: null,
	embedding_version: null,
	playlist_count: 1,
	playlist_set_hash: "pls",
	snapshot_hash: "snap",
	song_count: 1,
	weights: {},
};

describe("buildOneProposal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(deriveProposalSubjects).mockResolvedValue(
			Result.ok({
				subjects: [],
				hiddenReviewItemCount: 2,
				filtersByPlaylistId: new Map(),
			}),
		);
	});

	function mockProposalWrites() {
		const single = vi.fn().mockResolvedValue({
			data: { id: "prop-1" },
			error: null,
		});
		const select = vi.fn().mockReturnValue({ single });
		const upsert = vi.fn().mockReturnValue({ select });
		const updateEq = vi.fn().mockResolvedValue({ error: null });
		const update = vi.fn().mockReturnValue({ eq: updateEq });
		const deleteEq = vi.fn().mockResolvedValue({ error: null });
		const deleteRows = vi.fn().mockReturnValue({ eq: deleteEq });
		const from = vi.fn((table: string) => {
			switch (table) {
				case "match_review_proposal":
					return { upsert, update };
				case "match_review_proposal_subject":
					return { delete: deleteRows };
				default:
					throw new Error(`Unexpected table ${table}`);
			}
		});

		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		return { update, updateEq, upsert };
	}

	it("marks the proposal stale when a newer snapshot published mid-build", async () => {
		const { update, updateEq } = mockProposalWrites();
		vi.mocked(getLatestMatchSnapshot).mockResolvedValue(
			Result.ok({ ...SNAPSHOT_ROW, id: "snap-newer" }),
		);

		const result = await buildOneProposal(
			"acct-1",
			"song",
			"snap-1",
			"balanced",
			0.5,
			Date.parse("2026-07-07T12:00:00Z"),
		);

		expect(result).toBeOk();
		expect(update).toHaveBeenCalledWith({
			status: "stale",
			total_subjects: 0,
			hidden_review_item_count: 2,
		});
		expect(updateEq).toHaveBeenCalledWith("id", "prop-1");
	});

	it("marks the proposal ready when the snapshot is still latest", async () => {
		const { update } = mockProposalWrites();
		vi.mocked(getLatestMatchSnapshot).mockResolvedValue(
			Result.ok(SNAPSHOT_ROW),
		);

		const result = await buildOneProposal(
			"acct-1",
			"playlist",
			"snap-1",
			"balanced",
			0.5,
			Date.parse("2026-07-07T12:00:00Z"),
		);

		expect(result).toBeOk();
		expect(update).toHaveBeenCalledWith({
			status: "ready",
			total_subjects: 0,
			hidden_review_item_count: 2,
		});
	});
});
