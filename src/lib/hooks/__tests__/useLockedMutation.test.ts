import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureRouteError } from "@/lib/observability/sentry";
import { useLockedMutation } from "../useLockedMutation";

vi.mock("@/lib/observability/sentry", () => ({
	captureRouteError: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn() },
}));

function makeWrapper(queryClient: QueryClient) {
	return ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("useLockedMutation", () => {
	it("locks, invalidates on success, and never releases the lock on the success path by default", async () => {
		const queryClient = new QueryClient();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
		const onLockNavigation = vi.fn(() => true);
		const onReleaseNavigation = vi.fn();
		const key = ["thing", "1"];

		const { result } = renderHook(
			() =>
				useLockedMutation(queryClient, {
					operation: "test.success",
					mutationFn: async (id: string) => ({ ok: true, id }),
					onLockNavigation,
					onReleaseNavigation,
					invalidateKeys: (result) => [["thing", result.id]],
				}),
			{ wrapper: makeWrapper(queryClient) },
		);

		let returned: unknown;
		await act(async () => {
			returned = await result.current.run("1");
		});

		expect(onLockNavigation).toHaveBeenCalledTimes(1);
		expect(returned).toEqual({ ok: true, id: "1" });
		expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: key });
		// Success does not auto-release by default — the caller's own
		// transition (e.g. an itemId change effect) is expected to release it.
		expect(onReleaseNavigation).not.toHaveBeenCalled();
	});

	it("releases the lock on success when releaseOnSuccess is set", async () => {
		const queryClient = new QueryClient();
		const onLockNavigation = vi.fn(() => true);
		const onReleaseNavigation = vi.fn();

		const { result } = renderHook(
			() =>
				useLockedMutation(queryClient, {
					operation: "test.releaseOnSuccess",
					mutationFn: async () => ({ ok: true }),
					onLockNavigation,
					onReleaseNavigation,
					releaseOnSuccess: true,
				}),
			{ wrapper: makeWrapper(queryClient) },
		);

		await act(async () => {
			await result.current.run(undefined);
		});

		expect(onReleaseNavigation).toHaveBeenCalledTimes(1);
	});

	it("does not run the mutation when the navigation lock is already held", async () => {
		const queryClient = new QueryClient();
		const mutationFn = vi.fn(async () => ({ ok: true }));
		const onLockNavigation = vi.fn(() => false);
		const onReleaseNavigation = vi.fn();

		const { result } = renderHook(
			() =>
				useLockedMutation(queryClient, {
					operation: "test.locked",
					mutationFn,
					onLockNavigation,
					onReleaseNavigation,
				}),
			{ wrapper: makeWrapper(queryClient) },
		);

		let returned: unknown;
		await act(async () => {
			returned = await result.current.run(undefined);
		});

		expect(mutationFn).not.toHaveBeenCalled();
		expect(returned).toBeUndefined();
	});

	it("surfaces a typed (non-thrown) failure by releasing the lock without invalidating", async () => {
		const queryClient = new QueryClient();
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
		const onLockNavigation = vi.fn(() => true);
		const onReleaseNavigation = vi.fn();
		const onRetryableFailure = vi.fn();

		const { result } = renderHook(
			() =>
				useLockedMutation(queryClient, {
					operation: "test.typedFailure",
					mutationFn: async () => ({ ok: false, reason: "rejected" }),
					isSuccess: (r) => r.ok,
					onLockNavigation,
					onReleaseNavigation,
					onRetryableFailure,
					invalidateKeys: [["should-not-invalidate"]],
				}),
			{ wrapper: makeWrapper(queryClient) },
		);

		let returned: unknown;
		await act(async () => {
			returned = await result.current.run(undefined);
		});

		expect(returned).toEqual({ ok: false, reason: "rejected" });
		expect(onReleaseNavigation).toHaveBeenCalledTimes(1);
		expect(onRetryableFailure).toHaveBeenCalledWith(
			{ ok: false, reason: "rejected" },
			undefined,
		);
		expect(invalidateSpy).not.toHaveBeenCalled();
		// Typed failures are expected flow control (e.g. "already resolved"), not
		// unexpected errors — they should not spam Sentry/toast.
		expect(captureRouteError).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("reconciles a stale result via onStale without releasing by default", async () => {
		const queryClient = new QueryClient();
		const onLockNavigation = vi.fn(() => true);
		const onReleaseNavigation = vi.fn();
		const onStale = vi.fn();

		const { result } = renderHook(
			() =>
				useLockedMutation(queryClient, {
					operation: "test.stale",
					mutationFn: async () => ({ ok: false, reason: "already_resolved" }),
					isSuccess: (r) => r.ok,
					isStale: (r) => r.reason === "already_resolved",
					onLockNavigation,
					onReleaseNavigation,
					onStale,
				}),
			{ wrapper: makeWrapper(queryClient) },
		);

		await act(async () => {
			await result.current.run(undefined);
		});

		expect(onStale).toHaveBeenCalledTimes(1);
		expect(onReleaseNavigation).not.toHaveBeenCalled();
	});

	it("releases the lock, captures, and toasts when the mutation throws", async () => {
		const queryClient = new QueryClient();
		const onLockNavigation = vi.fn(() => true);
		const onReleaseNavigation = vi.fn();
		const error = new Error("network down");

		const { result } = renderHook(
			() =>
				useLockedMutation(queryClient, {
					operation: "test.thrown",
					mutationFn: async () => {
						throw error;
					},
					onLockNavigation,
					onReleaseNavigation,
					errorMessage: "Could not save. Try again.",
				}),
			{ wrapper: makeWrapper(queryClient) },
		);

		let returned: unknown;
		await act(async () => {
			returned = await result.current.run(undefined);
		});

		await waitFor(() => {
			expect(onReleaseNavigation).toHaveBeenCalledTimes(1);
		});
		expect(returned).toBeUndefined();
		expect(captureRouteError).toHaveBeenCalledWith(error, {
			operation: "test.thrown",
		});
		expect(toast.error).toHaveBeenCalledWith("Could not save. Try again.");
	});
});
