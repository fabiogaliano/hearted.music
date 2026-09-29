import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";
import { createPollLoop } from "../poll-loop";

type Job = { id: string };
type ClaimResult = Result<Job | null, { message: string }>;

describe("createPollLoop", () => {
	it("does not exceed concurrency when a NOTIFY wake overlaps the poll tick's in-flight claim", async () => {
		const pendingClaims: Array<(result: ClaimResult) => void> = [];
		const claim = vi.fn(
			() =>
				new Promise<ClaimResult>((resolve) => {
					pendingClaims.push(resolve);
				}),
		);
		const markDones: Array<() => void> = [];
		const loop = createPollLoop<Job, { message: string }>({
			concurrency: () => 1,
			claim,
			jobId: (job) => job.id,
			onClaimError: vi.fn(),
			dispatch: (_job, markDone) => {
				markDones.push(markDone);
			},
			pollIntervalMs: 1000,
		});

		const pollTick = loop.claimAndDispatch();
		const notifyWake = loop.claimAndDispatch();
		await Promise.resolve();

		expect(claim).toHaveBeenCalledTimes(1);

		pendingClaims[0](Result.ok({ id: "job-1" }));
		await Promise.all([pollTick, notifyWake]);

		expect(loop.getActiveCount()).toBe(1);
		expect(claim).toHaveBeenCalledTimes(1);

		// Freeing the slot lets the next wake claim again and drain until empty.
		markDones[0]();
		const nextWake = loop.claimAndDispatch();
		expect(claim).toHaveBeenCalledTimes(2);
		pendingClaims[1](Result.ok(null));
		await nextWake;
		expect(loop.getActiveCount()).toBe(0);
	});

	it("releases the reserved slot when the claim fails", async () => {
		const claim = vi
			.fn<() => Promise<ClaimResult>>()
			.mockResolvedValueOnce(Result.err({ message: "db down" }))
			.mockResolvedValueOnce(Result.ok(null));
		const loop = createPollLoop<Job, { message: string }>({
			concurrency: () => 1,
			claim,
			jobId: (job) => job.id,
			onClaimError: vi.fn(),
			dispatch: vi.fn(),
			pollIntervalMs: 1000,
		});

		await loop.claimAndDispatch();
		await loop.claimAndDispatch();

		expect(claim).toHaveBeenCalledTimes(2);
	});
});
