/**
 * Tests for useDashboardSync — the orchestration behind the dashboard sync
 * control: verdict → CTA mapping (the connection state is now injected, not
 * self-detected — see docs/plans/extension-connection-service/03-dashboard.md),
 * idle vs active GET_STATUS polling, awaited trigger outcomes, and exact 429
 * handling from structured backend failures forwarded through the extension.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionVerdict } from "@/lib/extension/connection/verdict";
import type { ExtensionSyncState } from "@/lib/extension/detect";
import {
	EXTENSION_SYNC_ALREADY_RUNNING,
	EXTENSION_SYNC_COOLDOWN,
} from "../../../../../shared/extension-sync-contract";
import { useDashboardSync } from "../useDashboardSync";

const mockRequestExtensionSync = vi.fn();
const mockExpectLoginReturn = vi.fn();
const mockPairExtension = vi.fn();
const mockUseExtensionSyncStatus = vi.fn();
const mockReportSpotifyAuthSuccess = vi.fn();

vi.mock("@/lib/extension/detect", () => ({
	requestExtensionSync: () => mockRequestExtensionSync(),
	expectLoginReturn: (armToken: string) => mockExpectLoginReturn(armToken),
}));

vi.mock("@/lib/extension/connect", () => ({
	pairExtension: () => mockPairExtension(),
}));

vi.mock("@/lib/extension/useExtensionSyncStatus", () => ({
	useExtensionSyncStatus: (options: unknown) =>
		mockUseExtensionSyncStatus(options),
}));

// The push/clear channel — asserted as "was it called", not re-tested for its
// own internals (that's report-failure.test.ts's job). `useDashboardSync` no
// longer pushes a failure from this hook (see DECISIONS.md Phase 03, finding
// 2 — no reliable signal at this call site), only clears one on success.
vi.mock("@/lib/extension/connection/report-failure", () => ({
	reportSpotifyAuthSuccess: (qc: unknown) => mockReportSpotifyAuthSuccess(qc),
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
		// Default: verdict ok, no live sync → ready.
		mockUseExtensionSyncStatus.mockReturnValue({ sync: null, hasToken: true });
		mockRequestExtensionSync.mockResolvedValue({ ok: true, count: 10 });
		mockExpectLoginReturn.mockResolvedValue(true);
		mockPairExtension.mockResolvedValue({ ok: true });
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reports install-required when the verdict is extension-missing", () => {
		const { result } = renderHook(
			() => useDashboardSync(ACCOUNT_ID, { kind: "extension-missing" }),
			{ wrapper },
		);
		expect(result.current.state.kind).toBe("install-required");
	});

	it("reports checking while the verdict hasn't settled", () => {
		const { result } = renderHook(
			() => useDashboardSync(ACCOUNT_ID, { kind: "checking" }),
			{ wrapper },
		);
		expect(result.current.state.kind).toBe("checking");
	});

	it("pre-link: prompts to reconnect Spotify from the control itself, and a click repairs in one gesture (opens Spotify + re-pairs)", async () => {
		const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
		const { result } = renderHook(
			() =>
				useDashboardSync(ACCOUNT_ID, { kind: "spotify-disconnected" }, null),
			{ wrapper },
		);
		expect(result.current.state.kind).toBe("spotify-reconnect-required");

		await act(async () => {
			result.current.onAction();
		});

		// repairConnection opens Spotify so the extension recaptures the token,
		// and silently re-pairs alongside it — the fresh-install case (both
		// credentials gone) now resolves in a single click. (Deviation from the
		// old behavior, which asserted pairExtension was *not* called here — see
		// DECISIONS.md Phase 03.)
		expect(openSpy).toHaveBeenCalledTimes(1);
		expect(openSpy.mock.calls[0]?.[0]).toContain("spotify.com");
		expect(mockPairExtension).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ kind: "checking" as const },
		{ kind: "spotify-disconnected" as const },
		{
			kind: "mismatch" as const,
			extensionProfile: {
				spotifyId: "wrong-id",
				displayName: "Wrong Person",
				avatarUrl: null,
			},
		},
		{ kind: "unpaired" as const },
		{ kind: "unverifiable" as const },
	])("blocks sync for a linked account's $kind verdict (checking renders its own status; every other non-ok verdict collapses to paused, letting the banner own the action)", (verdict) => {
		const { result } = renderHook(
			() => useDashboardSync(ACCOUNT_ID, verdict, "spotify-1"),
			{ wrapper },
		);
		const expectedKind = verdict.kind === "checking" ? "checking" : "paused";
		expect(result.current.state.kind).toBe(expectedKind);
		result.current.onAction();
		expect(mockRequestExtensionSync).not.toHaveBeenCalled();
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
		expect(state.action).toBe("retry");
		expect(state.retryable).toBe(true);
	});

	it("a dead-session sync failure surfaces as a plain retryable error and never pushes a shared auth failure — no reliable signal at this call site (DECISIONS.md Phase 03, finding 2)", async () => {
		mockRequestExtensionSync.mockResolvedValue({
			ok: false,
			source: "extension",
			error: "no spotify token",
		});

		const { result } = renderHook(
			() => useDashboardSync(ACCOUNT_ID, { kind: "ok" }, "spotify-1"),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.state.kind).toBe("ready"));

		await act(async () => {
			result.current.onAction();
		});

		await waitFor(() => expect(result.current.state.kind).toBe("error"));
		const state = result.current.state;
		if (state.kind !== "error") throw new Error("expected error state");
		expect(state.action).toBe("retry");
		expect(state.message).toBe("no spotify token");
	});

	it("clears a sticky auth failure when a sync completes successfully — the bound the README's Risks section promises", async () => {
		const { result } = renderHook(() => useDashboardSync(ACCOUNT_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.state.kind).toBe("ready"));

		await act(async () => {
			result.current.onAction();
		});

		await waitFor(() => expect(result.current.state.kind).toBe("success"));
		expect(mockReportSpotifyAuthSuccess).toHaveBeenCalledTimes(1);
	});

	it("a broken verdict on a linked account outranks a stale error phase — no competing affordance next to the banner's, and no doomed retry", async () => {
		mockRequestExtensionSync
			.mockResolvedValueOnce(null)
			.mockResolvedValue({ ok: true, count: 10 });

		const { result, rerender } = renderHook(
			({ verdict }: { verdict: ConnectionVerdict }) =>
				useDashboardSync(ACCOUNT_ID, verdict, "spotify-1"),
			{
				initialProps: { verdict: { kind: "ok" } as ConnectionVerdict },
				wrapper,
			},
		);
		await waitFor(() => expect(result.current.state.kind).toBe("ready"));

		await act(async () => {
			result.current.onAction();
		});
		await waitFor(() => expect(result.current.state.kind).toBe("error"));

		// The connection goes genuinely bad (e.g. another surface pushed a
		// failure, or the shared poll now sees the account unpaired) while this
		// control is still sitting on a stale "error" phase from an earlier,
		// unrelated failure. The banner is about to render its own Reconnect CTA
		// for this same verdict — the control must collapse to status-only
		// ("paused") instead of keeping its Retry button up alongside it, and
		// that Retry must not be wired to fire: retrying a connection that's
		// known broken can't succeed.
		rerender({ verdict: { kind: "unpaired" } });
		expect(result.current.state.kind).toBe("paused");

		result.current.onAction();
		expect(mockRequestExtensionSync).toHaveBeenCalledTimes(1);

		// Once the connection genuinely recovers, the stale phase resurfaces
		// exactly as it did before — nothing here ever reset it, so there's
		// still a real error to show, and retry still works.
		rerender({ verdict: { kind: "ok" } });
		expect(result.current.state.kind).toBe("error");

		await act(async () => {
			result.current.onAction();
		});
		expect(mockRequestExtensionSync).toHaveBeenCalledTimes(2);
	});

	it("silently re-pairs and retries once when the backend rejects auth", async () => {
		// The apiToken was revoked/cleared: first TRIGGER_SYNC 401s, pairExtension
		// re-mints it, the retry succeeds. No user-facing reconnect step.
		mockRequestExtensionSync
			.mockResolvedValueOnce({
				ok: false,
				source: "backend",
				count: 0,
				backendFailure: {
					status: 401,
					code: "unknown",
					message: "Unauthorized",
					retryAfterSeconds: null,
				},
			})
			.mockResolvedValue({ ok: true, count: 10 });

		const { result } = renderHook(() => useDashboardSync(ACCOUNT_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.state.kind).toBe("ready"));

		await act(async () => {
			result.current.onAction();
		});

		expect(mockPairExtension).toHaveBeenCalledTimes(1);
		expect(mockRequestExtensionSync).toHaveBeenCalledTimes(2);
		await waitFor(() => expect(result.current.state.kind).toBe("success"));
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
