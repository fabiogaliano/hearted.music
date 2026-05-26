/**
 * Tests for useDashboardSync — the orchestration behind the dashboard sync
 * control: detection → CTA mapping, idle vs active GET_STATUS polling,
 * awaited trigger outcomes, and exact 429 handling from structured backend
 * failures forwarded through the extension.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionSyncState } from "@/lib/extension/detect";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
} from "../../../../../shared/extension-sync-contract";
import { useDashboardSync } from "../useDashboardSync";

const mockIsExtensionInstalled = vi.fn();
const mockGetSpotifyConnectionStatus = vi.fn();
const mockRequestExtensionSync = vi.fn();
const mockPairExtension = vi.fn();
const mockUseExtensionSyncStatus = vi.fn();

vi.mock("@/lib/extension/detect", () => ({
	isExtensionInstalled: () => mockIsExtensionInstalled(),
	getSpotifyConnectionStatus: () => mockGetSpotifyConnectionStatus(),
	requestExtensionSync: () => mockRequestExtensionSync(),
}));

vi.mock("@/lib/extension/connect", () => ({
	pairExtension: () => mockPairExtension(),
}));

vi.mock("@/lib/extension/useExtensionSyncStatus", () => ({
	useExtensionSyncStatus: (options: unknown) =>
		mockUseExtensionSyncStatus(options),
}));

function makeSync(overrides?: Partial<ExtensionSyncState>): ExtensionSyncState {
	return {
		status: "idle",
		phase: "idle",
		fetched: 0,
		total: 0,
		likedSongs: { fetched: 0, total: 0 },
		playlists: { fetched: 0, total: 0 },
		playlistTracks: { fetched: 0, total: 0 },
		artistImages: { fetched: 0, total: 0 },
		lastSyncAt: null,
		error: null,
		...overrides,
	};
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

const ACCOUNT_ID = "acct-1";

describe("useDashboardSync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		// Default: installed, paired, connected, no live sync → ready.
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(true);
		mockUseExtensionSyncStatus.mockReturnValue({ sync: null, hasToken: true });
		mockRequestExtensionSync.mockResolvedValue({ ok: true, count: 10 });
		mockPairExtension.mockResolvedValue({ ok: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reports install-required when the extension is absent", async () => {
		mockIsExtensionInstalled.mockResolvedValue(false);
		const { result } = renderHook(() => useDashboardSync(ACCOUNT_ID), {
			wrapper,
		});
		await waitFor(() =>
			expect(result.current.state.kind).toBe("install-required"),
		);
	});

	it("reports reconnect-required when installed but unpaired", async () => {
		mockUseExtensionSyncStatus.mockReturnValue({ sync: null, hasToken: false });
		const { result } = renderHook(() => useDashboardSync(ACCOUNT_ID), {
			wrapper,
		});
		await waitFor(() =>
			expect(result.current.state.kind).toBe("reconnect-required"),
		);

		await act(async () => {
			result.current.onAction();
		});
		expect(mockPairExtension).toHaveBeenCalledTimes(1);
	});

	it("requests a sync and invalidates dashboard queries exactly once on success", async () => {
		const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
		const { result } = renderHook(() => useDashboardSync(ACCOUNT_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.state.kind).toBe("ready"));

		await act(async () => {
			result.current.onAction();
		});

		expect(mockRequestExtensionSync).toHaveBeenCalledTimes(1);
		await waitFor(() => expect(result.current.state.kind).toBe("success"));

		const pageDataInvalidations = invalidateSpy.mock.calls.filter((call) =>
			JSON.stringify(call[0]?.queryKey).includes("page-data"),
		);
		expect(pageDataInvalidations).toHaveLength(1);
	});

	it("surfaces a retryable error with the right recovery action when unreachable", async () => {
		mockRequestExtensionSync.mockResolvedValue(null);
		const { result } = renderHook(() => useDashboardSync(ACCOUNT_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.state.kind).toBe("ready"));

		await act(async () => {
			result.current.onAction();
		});

		await waitFor(() => expect(result.current.state.kind).toBe("error"));
		const state = result.current.state;
		if (state.kind !== "error") throw new Error("expected error state");
		expect(state.action).toBe("reconnect");
		expect(state.retryable).toBe(true);
	});

	it("uses the backend retry-after for cooldown instead of inferring from local state", async () => {
		mockUseExtensionSyncStatus.mockReturnValue({
			sync: makeSync({ status: "idle", lastSyncAt: null }),
			hasToken: true,
		});
		mockRequestExtensionSync.mockResolvedValue({
			ok: false,
			source: "backend",
			count: 0,
			backendFailure: {
				status: 429,
				code: EXTENSION_SYNC_COOLDOWN,
				message:
					"Library sync was run too recently for this account. Wait before trying again.",
				retryAfterSeconds: 45,
			},
		});

		const { result } = renderHook(() => useDashboardSync(ACCOUNT_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.state.kind).toBe("ready"));

		await act(async () => {
			result.current.onAction();
		});

		await waitFor(() => expect(result.current.state.kind).toBe("cooldown"));
		const state = result.current.state;
		if (state.kind !== "cooldown") throw new Error("expected cooldown state");
		expect(state.retryAfterSeconds).toBe(45);
	});

	it("shows live progress when a sync is already running elsewhere", async () => {
		mockUseExtensionSyncStatus.mockReturnValue({
			sync: makeSync({ status: "syncing", phase: "playlists" }),
			hasToken: true,
		});
		const { result } = renderHook(() => useDashboardSync(ACCOUNT_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.state.kind).toBe("syncing"));
		const state = result.current.state;
		if (state.kind !== "syncing") throw new Error("expected syncing state");
		expect(state.sync.phase).toBe("playlists");
	});

	it("switches GET_STATUS to the active cadence while a sync is live", async () => {
		mockUseExtensionSyncStatus.mockReturnValue({
			sync: makeSync({ status: "syncing", phase: "playlists" }),
			hasToken: true,
		});

		renderHook(() => useDashboardSync(ACCOUNT_ID), { wrapper });

		await waitFor(() =>
			expect(mockUseExtensionSyncStatus).toHaveBeenLastCalledWith(
				expect.objectContaining({
					enabled: true,
					pollMs: 1_500,
				}),
			),
		);
	});

	it("clears the passive already-running phase after observed live sync ends", async () => {
		let extensionState = {
			sync: makeSync({ status: "idle" }),
			hasToken: true,
		};
		mockUseExtensionSyncStatus.mockImplementation(() => extensionState);
		mockRequestExtensionSync.mockResolvedValue({
			ok: false,
			source: "backend",
			count: 0,
			backendFailure: {
				status: 429,
				code: EXTENSION_SYNC_ALREADY_RUNNING,
				message:
					"A library sync is already running for this account. Wait for it to finish before trying again.",
				retryAfterSeconds: null,
			},
		});

		const { result, rerender } = renderHook(
			() => useDashboardSync(ACCOUNT_ID),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.state.kind).toBe("ready"));

		await act(async () => {
			result.current.onAction();
		});
		await waitFor(() =>
			expect(result.current.state.kind).toBe("already-running"),
		);

		extensionState = {
			sync: makeSync({ status: "syncing", phase: "playlists" }),
			hasToken: true,
		};
		rerender();
		await waitFor(() => expect(result.current.state.kind).toBe("syncing"));

		extensionState = {
			sync: makeSync({ status: "done", lastSyncAt: Date.now() }),
			hasToken: true,
		};
		rerender();

		await waitFor(() => expect(result.current.state.kind).toBe("ready"));
	});

	it("keeps the control non-retriggerable when TRIGGER_SYNC gets an active-sync 429", async () => {
		mockUseExtensionSyncStatus.mockReturnValue({
			sync: makeSync({ status: "error", error: "Backend HTTP 429" }),
			hasToken: true,
		});
		mockRequestExtensionSync.mockResolvedValue({
			ok: false,
			source: "backend",
			count: 0,
			backendFailure: {
				status: 429,
				code: EXTENSION_SYNC_ALREADY_RUNNING,
				message:
					"A library sync is already running for this account. Wait for it to finish before trying again.",
				retryAfterSeconds: null,
			},
		});

		const { result } = renderHook(() => useDashboardSync(ACCOUNT_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.state.kind).toBe("ready"));

		await act(async () => {
			result.current.onAction();
		});

		await waitFor(() =>
			expect(result.current.state.kind).toBe("already-running"),
		);
	});
});
