// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import { billingKeys } from "@/features/billing/query-keys";
import { getAccountEventsToken } from "@/lib/server/account-events.functions";
import { useAccountEvents } from "../useAccountEvents";

vi.mock("@/lib/server/account-events.functions", () => ({
	getAccountEventsToken: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const ACCOUNT_ID = "test-account-123";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("useAccountEvents", () => {
	let queryClient: QueryClient;

	function wrapper({ children }: { children: ReactNode }) {
		return createElement(
			QueryClientProvider,
			{ client: queryClient },
			children,
		);
	}

	function createMockStream() {
		let controller: ReadableStreamDefaultController<Uint8Array>;
		const stream = new ReadableStream({
			start(c) {
				controller = c;
			},
		});
		const encoder = new TextEncoder();
		return {
			stream,
			push: (text: string) => {
				controller.enqueue(encoder.encode(text));
			},
			close: () => {
				controller.close();
			},
		};
	}

	let createdStreams: ReturnType<typeof createMockStream>[] = [];

	function setupMockFetch(options: { ok?: boolean; status?: number } = {}) {
		mockFetch.mockImplementation(async (_url, fetchOptions) => {
			return new Promise((resolve, reject) => {
				const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
				if (fetchOptions?.signal) {
					if (fetchOptions.signal.aborted) return onAbort();
					fetchOptions.signal.addEventListener("abort", onAbort);
				}

				const { ok = true, status = 200 } = options;
				let body = null;
				if (ok) {
					const mockStream = createMockStream();
					createdStreams.push(mockStream);
					body = mockStream.stream;
				}

				resolve({ ok, status, body });
			});
		});
	}

	beforeEach(() => {
		vi.clearAllMocks();
		createdStreams = [];
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		(getAccountEventsToken as unknown as Mock).mockResolvedValue({
			token: "fake-token",
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("connects and processes a durable frame", async () => {
		setupMockFetch();
		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.connectionState).toBe("connected");
		});

		// Push a durable frame
		act(() => {
			for (const s of createdStreams) { s.push(); }
		});

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalledWith(
				"/account-events/stream",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer fake-token",
					}),
				}),
			);
		});

		for (const s of createdStreams) s.close();
	});

	it("dedupes and respects cursor monotonicity", async () => {
		setupMockFetch();
		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() =>
			expect(result.current.connectionState).toBe("connected"),
		);

		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		// Send id: 100
		act(() => {
			for (const s of createdStreams) { s.push(); }
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: billingKeys.state,
			});
		});

		invalidateSpy.mockClear();

		// Send id: 100 again (should be deduped)
		act(() => {
			for (const s of createdStreams) { s.push(); }
		});

		await sleep(20);
		expect(invalidateSpy).not.toHaveBeenCalled();

		// Send id: 99 (older, should be dropped)
		act(() => {
			for (const s of createdStreams) { s.push(); }
		});

		await sleep(20);
		expect(invalidateSpy).not.toHaveBeenCalled();

		// Send id: 101 (newer, processed)
		act(() => {
			for (const s of createdStreams) { s.push(); }
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: billingKeys.state,
			});
		});

		for (const s of createdStreams) s.close();
	});

	it("does not advance cursor for live frames", async () => {
		setupMockFetch();
		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() =>
			expect(result.current.connectionState).toBe("connected"),
		);

		act(() => {
			for (const s of createdStreams) { s.push(); }
		});

		await waitFor(() => {
			expect(
				queryClient.getQueryData(["active-jobs", ACCOUNT_ID]),
			).toBeTruthy();
		});

		mockFetch.mockClear();

		act(() => {
			for (const s of createdStreams) { s.push(); }
		});

		await waitFor(() => {
			expect(mockFetch).toHaveBeenCalled();
			const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
			const headers = lastCall[1].headers as Record<string, string>;
			expect(headers["Last-Event-ID"]).toBeUndefined();
		});

		for (const s of createdStreams) s.close();
	});

	it("tolerates unknown types and comment frames", async () => {
		setupMockFetch();
		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() =>
			expect(result.current.connectionState).toBe("connected"),
		);

		act(() => {
			for (const s of createdStreams) { s.push(); }
		});

		await sleep(20);

		for (const s of createdStreams) s.close();
	});

	it("stops on 403 and sets state to forbidden", async () => {
		setupMockFetch({ ok: false, status: 403 });

		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.connectionState).toBe("forbidden");
		});

		await sleep(50);
		// With StrictMode, mount -> unmount -> remount means two connection attempts.
		// Both fail with 403, state is forbidden, no reconnect timers are started.
		expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(1);
	});
});
