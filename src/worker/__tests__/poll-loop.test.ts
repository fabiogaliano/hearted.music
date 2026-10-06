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

		// Freeing the slot claims again by itself; an overlapping wake still
		// can't push past the cap while that claim is in flight.
		markDones[0]();
		const nextWake = loop.claimAndDispatch();
		expect(claim).toHaveBeenCalledTimes(2);
		pendingClaims[1](Result.ok(null));
		await nextWake;
		await vi.waitFor(() => expect(loop.getActiveCount()).toBe(0));
	});

	it("claims a job queued while every slot was busy as soon as a slot frees, without waiting for the poll tick", async () => {
		const claim = vi
			.fn<() => Promise<ClaimResult>>()
			.mockResolvedValueOnce(Result.ok({ id: "job-1" }))
			.mockResolvedValueOnce(Result.ok({ id: "job-2" }))
			.mockResolvedValue(Result.ok(null));
		const dispatched: string[] = [];
		const markDones: Array<() => void> = [];
		const loop = createPollLoop<Job, { message: string }>({
			concurrency: () => 1,
			claim,
			jobId: (job) => job.id,
			onClaimError: vi.fn(),
			dispatch: (job, markDone) => {
				dispatched.push(job.id);
				markDones.push(markDone);
			},
			pollIntervalMs: 60_000,
		});

		await loop.claimAndDispatch();
		expect(dispatched).toEqual(["job-1"]);

		markDones[0]();
		await vi.waitFor(() => expect(dispatched).toEqual(["job-1", "job-2"]));
	});

	it("does not reclaim on a freed slot after stop()", async () => {
		const claim = vi
			.fn<() => Promise<ClaimResult>>()
			.mockResolvedValueOnce(Result.ok({ id: "job-1" }))
			.mockResolvedValue(Result.ok({ id: "job-2" }));
		const markDones: Array<() => void> = [];
		const loop = createPollLoop<Job, { message: string }>({
			concurrency: () => 1,
			claim,
			jobId: (job) => job.id,
			onClaimError: vi.fn(),
			dispatch: (_job, markDone) => {
				markDones.push(markDone);
			},
			pollIntervalMs: 60_000,
		});

		await loop.claimAndDispatch();
		loop.stop();
		markDones[0]();
		await Promise.resolve();

		expect(claim).toHaveBeenCalledTimes(1);
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

	it("does not dispatch a job whose in-flight claim resolves after stop(), and releases it", async () => {
		let resolveClaim: (result: ClaimResult) => void = () => {};
		const claim = vi.fn(
			() =>
				new Promise<ClaimResult>((resolve) => {
					resolveClaim = resolve;
				}),
		);
		const dispatch = vi.fn();
		let finishRelease: () => void = () => {};
		const release = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishRelease = resolve;
				}),
		);
		const loop = createPollLoop<Job, { message: string }>({
			concurrency: () => 1,
			claim,
			jobId: (job) => job.id,
			onClaimError: vi.fn(),
			dispatch,
			release,
			pollIntervalMs: 1000,
		});

		const tick = loop.claimAndDispatch();
		loop.stop();
		// Shutdown must keep waiting while the claim can still return a job.
		expect(loop.getActiveCount()).toBe(1);

		resolveClaim(Result.ok({ id: "job-1" }));
		await vi.waitFor(() =>
			expect(release).toHaveBeenCalledWith({ id: "job-1" }),
		);
		expect(loop.getActiveCount()).toBe(1);

		finishRelease();
		await tick;
		expect(dispatch).not.toHaveBeenCalled();
		expect(loop.getActiveCount()).toBe(0);
	});
});
