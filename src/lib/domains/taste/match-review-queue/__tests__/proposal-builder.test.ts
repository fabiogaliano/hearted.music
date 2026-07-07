import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables } from "@/lib/data/database.types";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import { deriveProposalSubjects } from "../eligible-subjects";
import { buildOneProposal } from "../proposal-builder";
import type { OrderedSubject } from "../types";
import { computeVisibleSuggestionList } from "../visible-suggestion-list";

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: vi.fn(),
}));
vi.mock("../eligible-subjects", () => ({
	deriveProposalSubjects: vi.fn(),
}));
// Spied rather than left real: buildSeedForSubject (private, unexported) calls
// this directly, so asserting its call args is how the seed branch's nowMs
// threading (M12) is observed from outside the module.
vi.mock("../visible-suggestion-list", () => ({
	computeVisibleSuggestionList: vi.fn(),
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
		// Only hit when the seed branch runs (subjects.length > 0): the subject
		// rows insert that precedes the per-subject seed derivation loop.
		const insertSubjects = vi.fn().mockResolvedValue({ error: null });
		const from = vi.fn((table: string) => {
			switch (table) {
				case "match_review_proposal":
					return { upsert, update };
				case "match_review_proposal_subject":
					return { delete: deleteRows, insert: insertSubjects };
				default:
					throw new Error(`Unexpected table ${table}`);
			}
		});

		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		return { update, updateEq, upsert, insertSubjects };
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

	it("M12: threads the builder's shared nowMs into computeVisibleSuggestionList when the seed branch runs", async () => {
		// The default beforeEach mock returns 0 subjects, which skips the seed
		// branch entirely — this case overrides it to return one subject so
		// buildSeedForSubject (and its computeVisibleSuggestionList call) actually
		// runs, the only way to observe M12's nowMs-threading fix from outside
		// the module (buildSeedForSubject itself is private/unexported).
		const { insertSubjects } = mockProposalWrites();
		vi.mocked(getLatestMatchSnapshot).mockResolvedValue(
			Result.ok(SNAPSHOT_ROW),
		);

		const subject: OrderedSubject = {
			subject: { orientation: "song", songId: "song-1" },
			maxScore: 0.8,
			wasNewAtEnqueue: false,
		};
		vi.mocked(deriveProposalSubjects).mockResolvedValue(
			Result.ok({
				subjects: [subject],
				hiddenReviewItemCount: 0,
				filtersByPlaylistId: new Map(),
			}),
		);
		// not-entitled short-circuits buildSeedForSubject to `[]` before it ever
		// reaches the seed-pair insert, so no match_review_proposal_seed_pair
		// mock is needed — only the nowMs pass-through into this call matters here.
		vi.mocked(computeVisibleSuggestionList).mockResolvedValue({
			kind: "not-entitled",
			reason: "song-not-entitled",
		});

		const sharedNowMs = Date.parse("2026-07-07T23:30:00Z");
		const result = await buildOneProposal(
			"acct-1",
			"song",
			"snap-1",
			"balanced",
			0.5,
			sharedNowMs,
		);

		expect(result).toBeOk();
		expect(insertSubjects).toHaveBeenCalledTimes(1);
		expect(computeVisibleSuggestionList).toHaveBeenCalledTimes(1);
		expect(computeVisibleSuggestionList).toHaveBeenCalledWith(
			expect.objectContaining({ subject: subject.subject }),
			0.5,
			sharedNowMs,
		);
	});
});
