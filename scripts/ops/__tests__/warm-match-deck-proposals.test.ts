import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountLatestSnapshot, WarmCounts } from "../warm-match-deck-proposals";
import { parseArgs, warmAccount } from "../warm-match-deck-proposals";

// warmAccount has no supabase-client dependency of its own (only
// iterateLatestSnapshotPerAccount/main do), so it's testable by mocking just
// the two DB-touching collaborators it calls directly — no @/env scaffolding
// needed. Vitest's shared config already seeds placeholder env vars for every
// node-project test (see vite.config.ts `env: isTest ? {...}`), which is what
// makes importing this module safe here even though a real `bun
// scripts/ops/warm-match-deck-proposals.ts` invocation requires real env vars.
const { mockEnqueueDeckJob, mockResolveVisibilityConfigHash } = vi.hoisted(
	() => ({
		mockEnqueueDeckJob: vi.fn(),
		mockResolveVisibilityConfigHash: vi.fn(),
	}),
);

vi.mock("@/lib/domains/taste/match-review-queue/deck-jobs", () => ({
	enqueueDeckJob: (...args: unknown[]) => mockEnqueueDeckJob(...args),
}));

vi.mock(
	"@/lib/domains/taste/match-review-queue/visibility-config-hash",
	() => ({
		resolveVisibilityConfigHash: (...args: unknown[]) =>
			mockResolveVisibilityConfigHash(...args),
	}),
);

function makeTarget(
	overrides: Partial<AccountLatestSnapshot> = {},
): AccountLatestSnapshot {
	return { accountId: "acct-1", snapshotId: "snap-1", ...overrides };
}

function makeCounts(overrides: Partial<WarmCounts> = {}): WarmCounts {
	return { accounts: 0, enqueued: 0, deduped: 0, failed: 0, ...overrides };
}

describe("parseArgs", () => {
	it("defaults dryRun to false with no flags", () => {
		expect(parseArgs(["bun", "script.ts"])).toEqual({ dryRun: false });
	});

	it("sets dryRun when --dry-run is passed", () => {
		expect(parseArgs(["bun", "script.ts", "--dry-run"])).toEqual({
			dryRun: true,
		});
	});

	it("throws on an unknown flag", () => {
		expect(() => parseArgs(["bun", "script.ts", "--bogus"])).toThrow(
			"Unknown option: --bogus",
		);
	});
});

describe("warmAccount", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnqueueDeckJob.mockResolvedValue(Result.ok({ id: "job-1" }));
		mockResolveVisibilityConfigHash.mockImplementation(
			(_accountId: string, orientation: string) =>
				Promise.resolve(
					Result.ok({
						hash: `vc_test_${orientation}`,
						minScore: 0.5,
						policy: {},
					}),
				),
		);
	});

	it("dry-run counts both orientations as would-enqueue without touching hash resolution or enqueue", async () => {
		const counts = makeCounts();

		await warmAccount(makeTarget(), true, counts);

		expect(mockResolveVisibilityConfigHash).not.toHaveBeenCalled();
		expect(mockEnqueueDeckJob).not.toHaveBeenCalled();
		expect(counts.enqueued).toBe(2);
	});

	it("enqueues build_proposals for both orientations with the exact hash-suffixed key", async () => {
		const counts = makeCounts();

		await warmAccount(makeTarget(), false, counts);

		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(2);
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith({
			accountId: "acct-1",
			orientation: "song",
			kind: "build_proposals",
			idempotencyKey: "build:acct-1:song:snap-1:vc_test_song",
			payload: { snapshotId: "snap-1" },
		});
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith({
			accountId: "acct-1",
			orientation: "playlist",
			kind: "build_proposals",
			idempotencyKey: "build:acct-1:playlist:snap-1:vc_test_playlist",
			payload: { snapshotId: "snap-1" },
		});
		expect(counts.enqueued).toBe(2);
		expect(counts.failed).toBe(0);
	});

	it("counts a null (already-pending) enqueue result as deduped, not enqueued", async () => {
		mockEnqueueDeckJob.mockResolvedValue(Result.ok(null));
		const counts = makeCounts();

		await warmAccount(makeTarget(), false, counts);

		expect(counts.deduped).toBe(2);
		expect(counts.enqueued).toBe(0);
	});

	it("skips the enqueue for an orientation whose hash resolution fails, still enqueues the other, and does not throw (M1/P3.4)", async () => {
		mockResolveVisibilityConfigHash.mockImplementation(
			(_accountId: string, orientation: string) => {
				if (orientation === "song") {
					return Promise.resolve(
						Result.err(new Error("hash resolution failed")),
					);
				}
				return Promise.resolve(
					Result.ok({
						hash: `vc_test_${orientation}`,
						minScore: 0.5,
						policy: {},
					}),
				);
			},
		);
		const counts = makeCounts();

		await expect(
			warmAccount(makeTarget(), false, counts),
		).resolves.toBeUndefined();

		// The failed orientation must never enqueue a hash-less (pre-M1) key —
		// it is counted as failed and skipped, not degraded to the old key shape.
		expect(mockEnqueueDeckJob).not.toHaveBeenCalledWith(
			expect.objectContaining({ orientation: "song" }),
		);
		expect(mockEnqueueDeckJob).toHaveBeenCalledTimes(1);
		expect(mockEnqueueDeckJob).toHaveBeenCalledWith(
			expect.objectContaining({
				orientation: "playlist",
				idempotencyKey: "build:acct-1:playlist:snap-1:vc_test_playlist",
			}),
		);
		expect(counts.failed).toBe(1);
		expect(counts.enqueued).toBe(1);
	});

	it("counts an enqueue failure without throwing", async () => {
		mockEnqueueDeckJob.mockResolvedValue(Result.err(new Error("db down")));
		const counts = makeCounts();

		await expect(
			warmAccount(makeTarget(), false, counts),
		).resolves.toBeUndefined();

		expect(counts.failed).toBe(2);
		expect(counts.enqueued).toBe(0);
	});
});
