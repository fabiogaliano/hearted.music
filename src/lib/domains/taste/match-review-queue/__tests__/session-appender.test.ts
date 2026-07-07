import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables } from "@/lib/data/database.types";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import {
	fetchActiveSession,
	fetchAppliedSnapshotIds,
	fetchTargetPlaylistFilters,
} from "../queries";
import { appendSessionsForAccountOrientation } from "../session-appender";
import { computeVisibilityPolicyHash } from "../visibility-policy";

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(),
}));
vi.mock("@/lib/domains/taste/song-matching/queries", () => ({
	getLatestMatchSnapshot: vi.fn(),
}));
vi.mock("../queries", () => ({
	fetchActiveSession: vi.fn(),
	fetchAppliedSnapshotIds: vi.fn(),
	fetchMaxPosition: vi.fn(),
	fetchQueuedPlaylistIds: vi.fn(),
	fetchQueuedSongIds: vi.fn(),
	fetchTargetPlaylistFilters: vi.fn(),
	insertQueueItems: vi.fn(),
	insertQueuePlaylistItems: vi.fn(),
	insertSessionSnapshot: vi.fn(),
}));
vi.mock("../visibility-policy", async () => {
	const actual = await vi.importActual<typeof import("../visibility-policy")>(
		"../visibility-policy",
	);
	return {
		...actual,
		computeVisibilityPolicyHash: vi.fn(),
	};
});

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

const SESSION = {
	id: "session-1",
	accountId: "acct-1",
	orientation: "song",
	status: "active",
	strictnessPreset: "balanced",
	strictnessMinScore: 0.5,
	createdAt: "2026-07-07T00:00:00Z",
	updatedAt: "2026-07-07T00:00:00Z",
	completedAt: null,
} as const;

describe("appendSessionsForAccountOrientation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fetchActiveSession).mockResolvedValue(Result.ok(SESSION));
		vi.mocked(computeVisibilityPolicyHash).mockReturnValue("vh-1");
	});

	it("skips as superseded when the job snapshot is no longer latest", async () => {
		vi.mocked(getLatestMatchSnapshot).mockResolvedValue(
			Result.ok({ ...SNAPSHOT_ROW, id: "snap-newer" }),
		);

		const result = await appendSessionsForAccountOrientation({
			accountId: "acct-1",
			orientation: "song",
			snapshotId: "snap-old",
		});

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toEqual({ kind: "superseded" });
		}
		expect(fetchTargetPlaylistFilters).not.toHaveBeenCalled();
	});

	it("repairs active_proposal_id on an already-applied replay when the proposal is ready", async () => {
		vi.mocked(getLatestMatchSnapshot).mockResolvedValue(
			Result.ok(SNAPSHOT_ROW),
		);
		vi.mocked(fetchTargetPlaylistFilters).mockResolvedValue(
			Result.ok(new Map()),
		);
		vi.mocked(fetchAppliedSnapshotIds).mockResolvedValue(
			Result.ok(new Set(["snap-1:vh-1"])),
		);

		const maybeSingle = vi.fn().mockResolvedValue({
			data: { id: "prop-1", status: "ready" },
			error: null,
		});
		const proposalEqHash = vi.fn().mockReturnValue({ maybeSingle });
		const proposalEqSnapshot = vi.fn().mockReturnValue({ eq: proposalEqHash });
		const proposalEqOrientation = vi
			.fn()
			.mockReturnValue({ eq: proposalEqSnapshot });
		const proposalEqAccount = vi
			.fn()
			.mockReturnValue({ eq: proposalEqOrientation });
		const proposalSelect = vi.fn().mockReturnValue({ eq: proposalEqAccount });

		const sessionUpdateEq = vi.fn().mockResolvedValue({ error: null });
		const sessionUpdate = vi.fn().mockReturnValue({ eq: sessionUpdateEq });

		const from = vi.fn((table: string) => {
			switch (table) {
				case "match_review_proposal":
					return { select: proposalSelect };
				case "match_review_session":
					return { update: sessionUpdate };
				default:
					throw new Error(`Unexpected table ${table}`);
			}
		});
		vi.mocked(createAdminSupabaseClient).mockReturnValue({
			from,
		} as unknown as ReturnType<typeof createAdminSupabaseClient>);

		const result = await appendSessionsForAccountOrientation({
			accountId: "acct-1",
			orientation: "song",
			snapshotId: "snap-1",
		});

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value).toEqual({
				kind: "applied",
				appendedCount: 0,
				sessionId: "session-1",
			});
		}
		expect(sessionUpdate).toHaveBeenCalledWith({
			active_proposal_id: "prop-1",
		});
		expect(sessionUpdateEq).toHaveBeenCalledWith("id", "session-1");
	});
});
