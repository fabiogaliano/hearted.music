import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminSupabaseClient } from "@/lib/data/client";
import type { Tables } from "@/lib/data/database.types";
import { getLatestMatchSnapshot } from "@/lib/domains/taste/song-matching/queries";
import { ConstraintError } from "@/lib/shared/errors/database";
import {
	fetchActiveSession,
	fetchAppliedSnapshotIds,
	fetchMaxPosition,
	fetchQueuedPlaylistIds,
	fetchQueuedSongIds,
	fetchTargetPlaylistFilters,
	insertQueueItems,
	insertQueuePlaylistItems,
} from "../queries";
import { appendSessionsForAccountOrientation } from "../session-appender";
import { computeVisibilityPolicyHash } from "../visibility-policy";

const { txMock, beginMock } = vi.hoisted(() => {
	const txMock = vi.fn().mockResolvedValue([{ session_id: "session-1" }]);
	return {
		txMock,
		beginMock: vi.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) =>
			cb(txMock),
		),
	};
});

vi.mock("postgres", () => ({
	default: () => ({ begin: beginMock }),
}));
vi.mock("@/lib/account-events/producer", () => ({
	writeAccountEvent: vi.fn(),
}));
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
		txMock.mockResolvedValue([{ session_id: "session-1" }]);
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

	/** Builds the `match_review_proposal` select chain (account/orientation/
	 *  snapshot/hash eq's terminating in maybeSingle) shared by the P3.1 cases
	 *  below — mirrors the replay test's chain above. */
	function mockProposalLookupChain(row: { id: string; status: string } | null) {
		const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
		const proposalEqHash = vi.fn().mockReturnValue({ maybeSingle });
		const proposalEqSnapshot = vi.fn().mockReturnValue({ eq: proposalEqHash });
		const proposalEqOrientation = vi
			.fn()
			.mockReturnValue({ eq: proposalEqSnapshot });
		const proposalEqAccount = vi
			.fn()
			.mockReturnValue({ eq: proposalEqOrientation });
		const proposalSelect = vi.fn().mockReturnValue({ eq: proposalEqAccount });
		return { select: proposalSelect };
	}

	describe("M3: constraint violation on insert must defer, not silently settle applied", () => {
		beforeEach(() => {
			vi.mocked(getLatestMatchSnapshot).mockResolvedValue(
				Result.ok(SNAPSHOT_ROW),
			);
			vi.mocked(fetchTargetPlaylistFilters).mockResolvedValue(
				Result.ok(new Map()),
			);
			vi.mocked(fetchAppliedSnapshotIds).mockResolvedValue(
				Result.ok(new Set()),
			);
			vi.mocked(fetchMaxPosition).mockResolvedValue(Result.ok(0));
		});

		it("insertQueueItems ConstraintError propagates as Result.err (song orientation) instead of settling applied/0", async () => {
			const proposalTable = mockProposalLookupChain({
				id: "prop-1",
				status: "ready",
			});
			const subjectsOrder = vi.fn().mockResolvedValue({
				data: [
					{
						proposal_id: "prop-1",
						position: 0,
						orientation: "song",
						song_id: "song-1",
						playlist_id: null,
						source_fit_score: 0.8,
						was_new_at_enqueue: false,
					},
				],
				error: null,
			});
			const subjectsEq = vi.fn().mockReturnValue({ order: subjectsOrder });
			const subjectsSelect = vi.fn().mockReturnValue({ eq: subjectsEq });
			const from = vi.fn((table: string) => {
				switch (table) {
					case "match_review_proposal":
						return proposalTable;
					case "match_review_proposal_subject":
						return { select: subjectsSelect };
					default:
						throw new Error(`Unexpected table ${table}`);
				}
			});
			vi.mocked(createAdminSupabaseClient).mockReturnValue({
				from,
			} as unknown as ReturnType<typeof createAdminSupabaseClient>);
			vi.mocked(fetchQueuedSongIds).mockResolvedValue(Result.ok(new Set()));

			const constraintError = new ConstraintError(
				"unique",
				"(session_id, position) collision",
			);
			vi.mocked(insertQueueItems).mockResolvedValue(
				Result.err(constraintError),
			);

			const result = await appendSessionsForAccountOrientation({
				accountId: "acct-1",
				orientation: "song",
				snapshotId: "snap-1",
			});

			expect(Result.isError(result)).toBe(true);
			if (Result.isError(result)) {
				expect(result.error).toBe(constraintError);
			}
			// The finalize transaction must never run when the insert itself failed —
			// that would silently drop the batch.
			expect(txMock).not.toHaveBeenCalled();
		});

		it("insertQueuePlaylistItems ConstraintError propagates as Result.err (playlist orientation) instead of settling applied/0", async () => {
			const proposalTable = mockProposalLookupChain({
				id: "prop-1",
				status: "ready",
			});
			const subjectsOrder = vi.fn().mockResolvedValue({
				data: [
					{
						proposal_id: "prop-1",
						position: 0,
						orientation: "playlist",
						song_id: null,
						playlist_id: "pl-1",
						source_fit_score: 0.8,
						was_new_at_enqueue: false,
					},
				],
				error: null,
			});
			const subjectsEq = vi.fn().mockReturnValue({ order: subjectsOrder });
			const subjectsSelect = vi.fn().mockReturnValue({ eq: subjectsEq });
			const from = vi.fn((table: string) => {
				switch (table) {
					case "match_review_proposal":
						return proposalTable;
					case "match_review_proposal_subject":
						return { select: subjectsSelect };
					default:
						throw new Error(`Unexpected table ${table}`);
				}
			});
			vi.mocked(createAdminSupabaseClient).mockReturnValue({
				from,
			} as unknown as ReturnType<typeof createAdminSupabaseClient>);
			vi.mocked(fetchQueuedPlaylistIds).mockResolvedValue(Result.ok(new Set()));

			const constraintError = new ConstraintError(
				"unique",
				"(session_id, position) collision",
			);
			vi.mocked(insertQueuePlaylistItems).mockResolvedValue(
				Result.err(constraintError),
			);

			const result = await appendSessionsForAccountOrientation({
				accountId: "acct-1",
				orientation: "playlist",
				snapshotId: "snap-1",
			});

			expect(Result.isError(result)).toBe(true);
			if (Result.isError(result)) {
				expect(result.error).toBe(constraintError);
			}
			expect(txMock).not.toHaveBeenCalled();
		});
	});

	it("guard (b): settles superseded on a persisted `stale` proposal status even when getLatestMatchSnapshot still matches the job snapshot", async () => {
		// Isolates the persisted-status guard (session-appender.ts:288-290) from
		// the live-snapshot guard (:241-245): the live snapshot check is made to
		// PASS here (still latest) so only the proposal's own `stale` status can
		// be the reason for the supersede — a live-snapshot-driven "superseded"
		// test already exists above and would not distinguish the two guards.
		vi.mocked(getLatestMatchSnapshot).mockResolvedValue(
			Result.ok(SNAPSHOT_ROW),
		);
		vi.mocked(fetchTargetPlaylistFilters).mockResolvedValue(
			Result.ok(new Map()),
		);
		vi.mocked(fetchAppliedSnapshotIds).mockResolvedValue(Result.ok(new Set()));

		const proposalTable = mockProposalLookupChain({
			id: "prop-1",
			status: "stale",
		});
		const from = vi.fn((table: string) => {
			switch (table) {
				case "match_review_proposal":
					return proposalTable;
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
			expect(result.value).toEqual({ kind: "superseded" });
		}
		// The function must return immediately on the `stale` status read — it
		// never reaches the subject fetch that a `ready` proposal would trigger.
		expect(fetchQueuedSongIds).not.toHaveBeenCalled();
	});
});
