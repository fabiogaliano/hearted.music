/**
 * Decision-tree tests for advanceActiveSession.
 *
 * Because advanceActiveSession receives appendLatestSnapshot,
 * hasSessionBeenSeeded, and createQueueFromLatestSnapshot as injected
 * dependencies, these tests drive the three branches without any vi.mock
 * hoisting — each test just passes the functions it needs.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";
import { advanceActiveSession } from "../pass-advance";

// ============================================================================
// Shared mock queries — countUnresolvedItems is the only query imported
// directly by pass-advance.ts, so we mock it via vi.mock.
// ============================================================================

vi.mock("../queries", () => ({
	countUnresolvedItems: vi.fn(),
	// Other query functions are not used by pass-advance.ts, but vi.mock
	// replaces the whole module so we export stubs to avoid import errors from
	// any transitive require.
	fetchActiveSession: vi.fn(),
	insertMatchReviewSession: vi.fn(),
	completeSession: vi.fn(),
	fetchAppliedSnapshotIds: vi.fn(),
	fetchQueuedSongIds: vi.fn(),
	fetchMaxPosition: vi.fn(),
	insertQueueItems: vi.fn(),
	insertSessionSnapshot: vi.fn(),
	fetchPendingSongIds: vi.fn(),
	updateQueueItemPresented: vi.fn(),
	updateQueueItemResolved: vi.fn(),
	clearSongNewness: vi.fn(),
}));

import * as queries from "../queries";

beforeEach(() => {
	vi.clearAllMocks();
});

const ACCOUNT_ID = "account-pass-advance-001";
const SESSION_ID = "session-pass-advance-001";

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

const noopAppend = vi.fn(async () =>
	Result.ok({ appendedCount: 0, alreadyApplied: false }),
);
const seededTrue = vi.fn(async () => Result.ok(true));
const seededFalse = vi.fn(async () => Result.ok(false));
const noopCreate = vi.fn(async () =>
	Result.ok<
		| {
				kind: "created";
				session: ReturnType<typeof fakeSession>;
				appendedCount: number;
		  }
		| { kind: "resumed"; session: ReturnType<typeof fakeSession> }
		| { kind: "no_snapshot" },
		never
	>({ kind: "no_snapshot" }),
);

// ============================================================================
// Branch 1: unresolved items remain — resumed-in-place
// ============================================================================

describe("advanceActiveSession — branch 1: unresolved items exist", () => {
	it("returns resumed-in-place when unresolved count > 0", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(3));

		const result = await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			noopAppend,
			seededTrue,
			noopCreate,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("resumed-in-place");
			if (result.value.kind === "resumed-in-place") {
				expect(result.value.session.id).toBe(SESSION_ID);
			}
		}
	});

	it("calls appendLatestSnapshot with the session and accountId", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(2));
		const appendFn = vi.fn(async () =>
			Result.ok({ appendedCount: 5, alreadyApplied: false }),
		);

		const result = await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			appendFn,
			seededTrue,
			noopCreate,
		);

		expect(result).toBeOk();
		expect(appendFn).toHaveBeenCalledWith(fakeSession(), ACCOUNT_ID);
		if (Result.isOk(result) && result.value.kind === "resumed-in-place") {
			expect(result.value.appendResult.appendedCount).toBe(5);
		}
	});

	it("propagates errors from appendLatestSnapshot in branch 1", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(1));
		const failingAppend = vi.fn(async () =>
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);

		const result = await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			failingAppend,
			seededTrue,
			noopCreate,
		);

		expect(result).toBeErr();
	});

	it("does not call completeSession or createQueueFromLatestSnapshot", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(1));
		const createFn = vi.fn(noopCreate);

		await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			noopAppend,
			seededTrue,
			createFn,
		);

		expect(createFn).not.toHaveBeenCalled();
	});
});

// ============================================================================
// Branch 2: zero unresolved, session not yet seeded — appended-while-seeding
// ============================================================================

describe("advanceActiveSession — branch 2: unseeded (first-creation race)", () => {
	it("returns appended-while-seeding when unresolved=0 and not seeded", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));

		const result = await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			noopAppend,
			seededFalse,
			noopCreate,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("appended-while-seeding");
		}
	});

	it("does NOT call completeSession — must not race the creator's first append", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
		// completeSession is not injected but is imported by pass-advance.ts from queries;
		// verifying the mock is never called proves the branch guard works.
		vi.mocked(queries.completeSession).mockResolvedValue(Result.ok(null));

		await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			noopAppend,
			seededFalse,
			noopCreate,
		);

		expect(queries.completeSession).not.toHaveBeenCalled();
	});

	it("does not call createQueueFromLatestSnapshot", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
		const createFn = vi.fn(noopCreate);

		await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			noopAppend,
			seededFalse,
			createFn,
		);

		expect(createFn).not.toHaveBeenCalled();
	});

	it("propagates errors from appendLatestSnapshot in branch 2", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
		const failingAppend = vi.fn(async () =>
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);

		const result = await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			failingAppend,
			seededFalse,
			noopCreate,
		);

		expect(result).toBeErr();
	});
});

// ============================================================================
// Branch 3: caught-up (zero unresolved, seeded) — rolled-over-and-created
//
// INVARIANT: completeSession must be called BEFORE createQueueFromLatestSnapshot
// so the partial unique index idx_match_review_session_one_active never sees
// two active rows simultaneously.
// ============================================================================

describe("advanceActiveSession — branch 3: caught-up rollover", () => {
	it("returns rolled-over-and-created when session is seeded and caught up", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
		vi.mocked(queries.completeSession).mockResolvedValue(Result.ok(null));
		const freshSession = { ...fakeSession(), id: "session-fresh-adv-001" };
		const createFn = vi.fn(async () =>
			Result.ok({
				kind: "created" as const,
				session: freshSession,
				appendedCount: 2,
			}),
		);

		const result = await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			noopAppend,
			seededTrue,
			createFn,
		);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.kind).toBe("rolled-over-and-created");
			if (result.value.kind === "rolled-over-and-created") {
				expect(result.value.freshQueueResult.kind).toBe("created");
			}
		}
	});

	it("preserves the completeSession-before-insert invariant (call order)", async () => {
		// This test pins the ordering guarantee that prevents a second active row
		// from violating idx_match_review_session_one_active.
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));

		const callOrder: string[] = [];
		vi.mocked(queries.completeSession).mockImplementation(async () => {
			callOrder.push("complete");
			return Result.ok(null);
		});
		const createFn = vi.fn(async () => {
			callOrder.push("create");
			return Result.ok({ kind: "no_snapshot" as const });
		});

		await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			noopAppend,
			seededTrue,
			createFn,
		);

		expect(callOrder).toEqual(["complete", "create"]);
	});

	it("propagates completeSession errors and does not call createQueueFromLatestSnapshot", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
		vi.mocked(queries.completeSession).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "conn lost" })),
		);
		const createFn = vi.fn(noopCreate);

		const result = await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			noopAppend,
			seededTrue,
			createFn,
		);

		expect(result).toBeErr();
		expect(createFn).not.toHaveBeenCalled();
	});

	it("does not call appendLatestSnapshot in the rollover branch", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
		vi.mocked(queries.completeSession).mockResolvedValue(Result.ok(null));
		const appendFn = vi.fn(noopAppend);

		await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			appendFn,
			seededTrue,
			noopCreate,
		);

		expect(appendFn).not.toHaveBeenCalled();
	});

	it("passes the fresh queue result through unchanged", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(Result.ok(0));
		vi.mocked(queries.completeSession).mockResolvedValue(Result.ok(null));
		const freshSession = { ...fakeSession(), id: "session-fresh-adv-002" };
		const createFn = vi.fn(async () =>
			Result.ok({
				kind: "created" as const,
				session: freshSession,
				appendedCount: 7,
			}),
		);

		const result = await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			noopAppend,
			seededTrue,
			createFn,
		);

		expect(result).toBeOk();
		if (
			Result.isOk(result) &&
			result.value.kind === "rolled-over-and-created" &&
			result.value.freshQueueResult.kind === "created"
		) {
			expect(result.value.freshQueueResult.session.id).toBe(
				"session-fresh-adv-002",
			);
			expect(result.value.freshQueueResult.appendedCount).toBe(7);
		}
	});
});

// ============================================================================
// Error propagation from countUnresolvedItems
// ============================================================================

describe("advanceActiveSession — countUnresolvedItems error", () => {
	it("propagates the error immediately without calling any injected function", async () => {
		vi.mocked(queries.countUnresolvedItems).mockResolvedValue(
			Result.err(new DatabaseError({ code: "08006", message: "db down" })),
		);
		const appendFn = vi.fn(noopAppend);
		const createFn = vi.fn(noopCreate);

		const result = await advanceActiveSession(
			fakeSession(),
			ACCOUNT_ID,
			appendFn,
			seededTrue,
			createFn,
		);

		expect(result).toBeErr();
		expect(appendFn).not.toHaveBeenCalled();
		expect(createFn).not.toHaveBeenCalled();
	});
});
