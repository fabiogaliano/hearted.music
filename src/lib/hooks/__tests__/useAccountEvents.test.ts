// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingKeys } from "@/features/billing/query-keys";
import { dashboardKeys } from "@/features/dashboard/queries";
import { likedSongsKeys } from "@/features/liked-songs/queries";
import { matchDeckKeys } from "@/features/matching/deck-queries";
import type {
	AccountEventPayloadMap,
	AllFrameType,
} from "@/lib/account-events/contract";
import { getAccountEventsToken } from "@/lib/server/account-events.functions";
import {
	accountEventsConnectionKey,
	useAccountEvents,
} from "../useAccountEvents";

vi.mock("@/lib/server/account-events.functions", () => ({
	getAccountEventsToken: vi.fn(),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const ACCOUNT_ID = "test-account-123";

function buildEnvelope<T extends AllFrameType>(
	type: T,
	data: AccountEventPayloadMap[T],
	publishId?: number,
) {
	return {
		type,
		v: 1 as const,
		ts: Date.now(),
		...(publishId === undefined ? {} : { publishId }),
		data,
	};
}

function buildFrame<T extends AllFrameType>(
	type: T,
	data: AccountEventPayloadMap[T],
	publishId?: number,
): string {
	const envelope = buildEnvelope(type, data, publishId);
	return `${publishId === undefined ? "" : `id: ${publishId}\n`}event: ${type}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

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
				let body: ReadableStream<Uint8Array> | null = null;
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
		vi.spyOn(Math, "random").mockReturnValue(0);
		vi.mocked(getAccountEventsToken).mockResolvedValue({
			token: "fake-token",
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("hydrates active-jobs from live snapshot frames and publishes connection state", async () => {
		setupMockFetch();
		const snapshot = {
			enrichment: null,
			matchSnapshotRefresh: null,
			firstMatchReady: false,
			firstVisibleMatchReady: true,
		};

		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.connectionState).toBe("connected");
		});

		act(() => {
			for (const stream of createdStreams) {
				stream.push(buildFrame("active_jobs_snapshot", snapshot));
			}
		});

		await waitFor(() => {
			expect(queryClient.getQueryData(["active-jobs", ACCOUNT_ID])).toEqual(
				snapshot,
			);
			expect(
				queryClient.getQueryData(accountEventsConnectionKey(ACCOUNT_ID)),
			).toBe("connected");
		});
	});

	it("dedupes durable frames by publish id", async () => {
		setupMockFetch();
		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.connectionState).toBe("connected");
		});

		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		act(() => {
			for (const stream of createdStreams) {
				stream.push(buildFrame("billing_state_changed", {}, 100));
			}
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: billingKeys.state,
			});
		});

		invalidateSpy.mockClear();

		act(() => {
			for (const stream of createdStreams) {
				stream.push(buildFrame("billing_state_changed", {}, 100));
				stream.push(buildFrame("billing_state_changed", {}, 99));
				stream.push(buildFrame("billing_state_changed", {}, 101));
			}
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledTimes(1);
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: billingKeys.state,
			});
		});
	});

	it("moves enrichment completion invalidations onto terminal events", async () => {
		setupMockFetch();
		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.connectionState).toBe("connected");
		});

		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		act(() => {
			for (const stream of createdStreams) {
				stream.push(
					buildFrame(
						"enrichment_completed",
						{
							jobId: "job-1",
							counts: { done: 10, total: 10, succeeded: 10, failed: 0 },
						},
						200,
					),
				);
			}
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledTimes(5);
		});

		const calledKeys = invalidateSpy.mock.calls.flatMap(([options]) =>
			options ? [options.queryKey] : [],
		);
		expect(calledKeys).toContainEqual(dashboardKeys.pageData(ACCOUNT_ID));
		expect(calledKeys).toContainEqual(dashboardKeys.stats(ACCOUNT_ID));
		expect(calledKeys).toContainEqual(dashboardKeys.recentActivity(ACCOUNT_ID));
		expect(calledKeys).toContainEqual(likedSongsKeys.stats(ACCOUNT_ID));
		expect(calledKeys).toContainEqual(likedSongsKeys.all);
	});

	it("invalidates the deck view from match publish and append events", async () => {
		setupMockFetch();
		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.connectionState).toBe("connected");
		});

		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		act(() => {
			for (const stream of createdStreams) {
				stream.push(
					buildFrame(
						"match_snapshot_published",
						{ orientation: "song", snapshotId: "snap-1" },
						300,
					),
				);
				stream.push(
					buildFrame(
						"match_deck_appended",
						{
							orientation: "playlist",
							sessionId: "sess-1",
							snapshotId: "snap-1",
							appendedCount: 2,
						},
						301,
					),
				);
			}
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: matchDeckKeys.deckRoot,
			});
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: matchDeckKeys.deck(ACCOUNT_ID, "playlist"),
			});
		});
	});

	it("invalidates active jobs when a refresh settles without a snapshot", async () => {
		setupMockFetch();
		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.connectionState).toBe("connected");
		});

		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

		act(() => {
			for (const stream of createdStreams) {
				stream.push(buildFrame("active_jobs_changed", {}, 302));
				stream.push(
					buildFrame(
						"match_snapshot_failed",
						{
							orientation: null,
							snapshotId: null,
							reason: "worker_error",
						},
						303,
					),
				);
			}
		});

		await waitFor(() => {
			expect(invalidateSpy).toHaveBeenCalledWith({
				queryKey: ["active-jobs", ACCOUNT_ID],
			});
		});
		expect(invalidateSpy).toHaveBeenCalledTimes(2);
	});

	it("does not promote Last-Event-ID from live frames across reconnects", async () => {
		setupMockFetch();
		const snapshot = {
			enrichment: null,
			matchSnapshotRefresh: null,
			firstMatchReady: false,
			firstVisibleMatchReady: false,
		};

		renderHook(() => useAccountEvents(ACCOUNT_ID), { wrapper });

		await waitFor(() => {
			expect(createdStreams).toHaveLength(1);
		});

		act(() => {
			createdStreams[0]?.push(buildFrame("active_jobs_snapshot", snapshot));
			createdStreams[0]?.close();
		});

		await waitFor(
			() => {
				expect(mockFetch).toHaveBeenCalledTimes(2);
			},
			{ timeout: 2500 },
		);

		const reconnectHeaders = mockFetch.mock.calls[1]?.[1]?.headers as
			| Record<string, string>
			| undefined;
		expect(reconnectHeaders?.["Last-Event-ID"]).toBeUndefined();
	});

	it("stops on 403 and sets state to forbidden", async () => {
		setupMockFetch({ ok: false, status: 403 });

		const { result } = renderHook(() => useAccountEvents(ACCOUNT_ID), {
			wrapper,
		});

		await waitFor(() => {
			expect(result.current.connectionState).toBe("forbidden");
		});

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});
});
