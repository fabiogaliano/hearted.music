import type { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchReviewKeys } from "@/features/matching/queries";
import { runMatchSnapshotRefreshEffects } from "../useActiveJobs";

vi.mock("@/lib/server/match-review-queue.functions", () => ({
	syncActiveMatchReviewSession: vi.fn(),
}));

// Import the mock after vi.mock so the reference is the hoisted spy.
import { syncActiveMatchReviewSession } from "@/lib/server/match-review-queue.functions";

const ACCOUNT_ID = "test-account-123";

function makeFakeQueryClient(): {
	invalidateQueries: ReturnType<typeof vi.fn>;
} & Pick<QueryClient, "invalidateQueries"> {
	return {
		invalidateQueries: vi.fn().mockResolvedValue(undefined),
	} as unknown as { invalidateQueries: ReturnType<typeof vi.fn> } & Pick<
		QueryClient,
		"invalidateQueries"
	>;
}

beforeEach(() => {
	vi.resetAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("runMatchSnapshotRefreshEffects", () => {
	it("(a) awaits syncActiveMatchReviewSession BEFORE any invalidation runs", async () => {
		// Use a deferred promise so we can observe that no invalidation fires
		// while the sync is still pending.
		let resolveSync!: () => void;
		const syncPromise = new Promise<void>((res) => {
			resolveSync = res;
		});
		vi.mocked(syncActiveMatchReviewSession).mockReturnValue(
			syncPromise as never,
		);

		const qc = makeFakeQueryClient();

		const effectPromise = runMatchSnapshotRefreshEffects(
			qc as unknown as QueryClient,
			ACCOUNT_ID,
		);

		// Sync is still pending — no invalidation should have fired yet.
		expect(qc.invalidateQueries).not.toHaveBeenCalled();

		// Let the sync settle, then wait for the full effect to finish.
		resolveSync();
		await effectPromise;

		// Now invalidations must have run.
		expect(qc.invalidateQueries).toHaveBeenCalled();
	});

	it("(b) invalidates matchReviewKeys.review(accountId) after sync resolves", async () => {
		vi.mocked(syncActiveMatchReviewSession).mockResolvedValue(
			undefined as never,
		);
		const qc = makeFakeQueryClient();

		await runMatchSnapshotRefreshEffects(
			qc as unknown as QueryClient,
			ACCOUNT_ID,
		);

		const calledKeys = (
			qc.invalidateQueries as ReturnType<typeof vi.fn>
		).mock.calls.map(
			(call: Array<{ queryKey?: unknown }>) => call[0]?.queryKey,
		);
		expect(calledKeys).toContainEqual(matchReviewKeys.review(ACCOUNT_ID));
	});

	it("(c) never invalidates any key matching matchReviewKeys.item(...)", async () => {
		vi.mocked(syncActiveMatchReviewSession).mockResolvedValue(
			undefined as never,
		);
		const qc = makeFakeQueryClient();

		await runMatchSnapshotRefreshEffects(
			qc as unknown as QueryClient,
			ACCOUNT_ID,
		);

		// matchReviewKeys.item(x) produces ["match-review", "item", x].
		// The item prefix is the first two segments: ["match-review", "item"].
		const itemPrefix = ["match-review", "item"];

		const calledKeys = (
			qc.invalidateQueries as ReturnType<typeof vi.fn>
		).mock.calls.map(
			(call: Array<{ queryKey?: unknown[] }>) => call[0]?.queryKey,
		);

		const hasItemKey = calledKeys.some(
			(key) =>
				Array.isArray(key) &&
				key.length >= itemPrefix.length &&
				itemPrefix.every((seg, i) => key[i] === seg),
		);

		expect(hasItemKey).toBe(false);
	});

	it("(d) runs all invalidations even when syncActiveMatchReviewSession rejects", async () => {
		vi.mocked(syncActiveMatchReviewSession).mockRejectedValue(
			new Error("network failure"),
		);
		const qc = makeFakeQueryClient();

		// Must not throw.
		await expect(
			runMatchSnapshotRefreshEffects(qc as unknown as QueryClient, ACCOUNT_ID),
		).resolves.toBeUndefined();

		// All five invalidation calls must still have run.
		expect(qc.invalidateQueries).toHaveBeenCalledTimes(5);

		const calledKeys = (
			qc.invalidateQueries as ReturnType<typeof vi.fn>
		).mock.calls.map(
			(call: Array<{ queryKey?: unknown }>) => call[0]?.queryKey,
		);
		expect(calledKeys).toContainEqual(matchReviewKeys.review(ACCOUNT_ID));
	});
});
