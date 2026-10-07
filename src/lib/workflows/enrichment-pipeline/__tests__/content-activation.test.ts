import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/shared/errors/database";

const mockApplyEntitlement = vi.fn();
const mockMarkItemsNew = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({}),
}));

vi.mock("@/lib/domains/billing/song-entitlement", () => ({
	applyEntitlementToSongs: (...args: unknown[]) =>
		mockApplyEntitlement(...args),
}));

vi.mock("@/lib/domains/library/liked-songs/status-queries", () => ({
	markItemsNew: (...args: unknown[]) => mockMarkItemsNew(...args),
}));

import { FAILURE_CODES } from "../failure-policy";
import { runContentActivation } from "../stages/content-activation";
import type { EnrichmentContext } from "../types";

function makeCtx(accountId = "account-1"): EnrichmentContext {
	return {
		accountId,
		embeddingService: {} as EnrichmentContext["embeddingService"],
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mockMarkItemsNew.mockResolvedValue(Result.ok([]));
});

describe("runContentActivation", () => {
	it("returns skipped outcome when songIds is empty", async () => {
		const outcome = await runContentActivation(makeCtx(), []);

		expect(outcome.kind).toBe("skipped");
		expect(mockApplyEntitlement).not.toHaveBeenCalled();
		expect(mockMarkItemsNew).not.toHaveBeenCalled();
	});

	it.each([
		"left_locked",
		"unlocked_self_hosted",
	] as const)("marks songs new after entitlement %s", async (kind) => {
		mockApplyEntitlement.mockResolvedValue(Result.ok({ kind }));

		const outcome = await runContentActivation(makeCtx(), ["song-1", "song-2"]);

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") return;
		expect(outcome.succeededSongIds).toEqual(["song-1", "song-2"]);
		expect(outcome.failures).toEqual([]);
		expect(mockMarkItemsNew).toHaveBeenCalledWith("account-1", "song", [
			"song-1",
			"song-2",
		]);
	});

	it("does not mark songs new itself after unlimited activation", async () => {
		mockApplyEntitlement.mockResolvedValue(
			Result.ok({ kind: "activated_unlimited" }),
		);

		const outcome = await runContentActivation(makeCtx(), ["song-1", "song-2"]);

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") return;
		expect(outcome.succeededSongIds).toEqual(["song-1", "song-2"]);
		expect(outcome.failures).toEqual([]);
		expect(mockMarkItemsNew).not.toHaveBeenCalled();
	});

	it("fails every song when markItemsNew fails", async () => {
		mockApplyEntitlement.mockResolvedValue(
			Result.ok({ kind: "unlocked_self_hosted" }),
		);
		mockMarkItemsNew.mockResolvedValue(
			Result.err({ message: "connection reset" }),
		);

		const outcome = await runContentActivation(makeCtx(), ["song-1", "song-2"]);

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") return;
		expect(outcome.succeededSongIds).toEqual([]);
		expect(outcome.failures.map((f) => f.songId)).toEqual(["song-1", "song-2"]);
		expect(outcome.failures[0].failureCode).toBe(
			FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
		);
		expect(outcome.failures[0].message).toContain("connection reset");
	});

	it("fails every song with the entitlement error and skips newness", async () => {
		mockApplyEntitlement.mockResolvedValue(
			Result.err(new DatabaseError({ code: "57014", message: "rpc timeout" })),
		);

		const outcome = await runContentActivation(makeCtx(), ["song-1", "song-2"]);

		expect(outcome.kind).toBe("attempted");
		if (outcome.kind !== "attempted") return;
		expect(outcome.succeededSongIds).toEqual([]);
		expect(outcome.failures.map((f) => f.songId)).toEqual(["song-1", "song-2"]);
		expect(outcome.failures[0].failureCode).toBe(
			FAILURE_CODES.CONTENT_ACTIVATION_FAILED,
		);
		expect(outcome.failures[0].message).toContain("rpc timeout");
		expect(mockMarkItemsNew).not.toHaveBeenCalled();
	});
});
