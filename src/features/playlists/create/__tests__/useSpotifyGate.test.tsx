/**
 * Tests for useSpotifyGate as a thin selector over the shared
 * `['extension','connection']` query (see
 * docs/plans/extension-connection-service/04-studio-gate.md). The
 * extension-detection mocks below (`isExtensionInstalled`/
 * `getSpotifyAccountStatus`) sit at the same seam connection-state.test.ts
 * mocks at, so these tests drive the REAL shared query through a REAL
 * QueryClient — anti-flicker and the focus re-check need the actual
 * TanStack Query machinery, not a stubbed verdict, to mean anything.
 *
 * Covers:
 *  - Verdict → gateState mapping on mount: not installed → extension-
 *    unavailable; installed but disconnected → reconnect-required; installed
 *    + connected → ok.
 *  - Invariant 4 (anti-flicker): once ok, a background refetch that's still
 *    in flight must not downgrade gateState to checking.
 *  - refetchOnWindowFocus (replaces the old hand-rolled focus/visibility
 *    listeners this hook used to own) re-checks the gate.
 *  - reportGateFailure('reconnect-required') pushes into the shared state —
 *    another consumer of the same QueryClient sees it too — and survives a
 *    following poll that still reports hasToken: true (invariant 7).
 *  - reportGateFailure('extension-unavailable') is a synchronous push
 *    (reportExtensionUnreachable), not a bare invalidate — the gate flips
 *    immediately, before any refetch could land.
 */

import {
	focusManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyAccountStatus } from "@/lib/extension/detect";

const { mockIsExtensionInstalled, mockGetSpotifyAccountStatus } = vi.hoisted(
	() => ({
		mockIsExtensionInstalled: vi.fn(),
		mockGetSpotifyAccountStatus: vi.fn(),
	}),
);

vi.mock("@/lib/extension/detect", () => ({
	isExtensionInstalled: () => mockIsExtensionInstalled(),
	getSpotifyAccountStatus: () => mockGetSpotifyAccountStatus(),
}));

import { resetAuthFailedAtForTests } from "@/lib/extension/connection/auth-failed-store";
import { resetUnreachableAtForTests } from "@/lib/extension/connection/unreachable-store";
import { useExtensionConnection } from "@/lib/extension/connection/useExtensionConnection";
import { useSpotifyGate } from "../useSpotifyGate";

function connectedStatus(
	overrides?: Partial<SpotifyAccountStatus>,
): SpotifyAccountStatus {
	return {
		connected: true,
		paired: true,
		profile: { spotifyId: "linked-1", displayName: "fabio", avatarUrl: null },
		...overrides,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

beforeEach(() => {
	mockIsExtensionInstalled.mockReset();
	mockGetSpotifyAccountStatus.mockReset();
	resetAuthFailedAtForTests();
	resetUnreachableAtForTests();
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
});

afterEach(() => {
	resetAuthFailedAtForTests();
	resetUnreachableAtForTests();
	// Restore focusManager to its default (falls back to document.visibilityState)
	// so a test that forces it doesn't leak into the next one in this file.
	focusManager.setFocused(undefined);
});

describe("useSpotifyGate — mount check", () => {
	it("starts in checking", () => {
		mockIsExtensionInstalled.mockResolvedValue(false);
		const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
		expect(result.current.gate.gateState).toBe("checking");
	});

	it("resolves to extension-unavailable when not installed", async () => {
		mockIsExtensionInstalled.mockResolvedValue(false);
		const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
		await waitFor(() =>
			expect(result.current.gate.gateState).toBe("extension-unavailable"),
		);
		expect(mockGetSpotifyAccountStatus).not.toHaveBeenCalled();
	});

	it("resolves to reconnect-required when installed but disconnected", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(
			connectedStatus({ connected: false }),
		);
		const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
		await waitFor(() =>
			expect(result.current.gate.gateState).toBe("reconnect-required"),
		);
	});

	it("resolves to ok when installed and connected", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
		const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
		await waitFor(() => expect(result.current.gate.gateState).toBe("ok"));
	});
});

// Findings 1+2 (CRITICAL, wrong-account data integrity): passing
// linkedSpotifyId: null collapsed deriveConnectionVerdict's mismatch check to
// a no-op (it short-circuits to "ok" as soon as installed+connected, before
// ever comparing the extension's profile against the linked account) — so a
// studio submit with the browser extension signed into a DIFFERENT Spotify
// account than hearted's linked one sailed through as "ok" and would create
// the playlist on the WRONG Spotify account. This block proves a real,
// non-null linkedSpotifyId actually surfaces the mismatch and that it maps to
// a gate state ("account-mismatch") CreateBar never treats as publishable —
// see CreateBar.test.tsx's "account-mismatch" coverage for the CTA-blocking
// half of this proof.
describe("useSpotifyGate — account mismatch (findings 1+2)", () => {
	const LINKED_SPOTIFY_ID = "hearted-linked-id";

	it("resolves to ok when the extension's Spotify profile matches the linked account", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(
			connectedStatus({
				profile: {
					spotifyId: LINKED_SPOTIFY_ID,
					displayName: "fabio",
					avatarUrl: null,
				},
			}),
		);
		const { result } = renderHook(() => useSpotifyGate(LINKED_SPOTIFY_ID), {
			wrapper,
		});
		// gate is the exact { gateState: "ok" } shape — the discriminated union
		// makes a stray mismatchProfile alongside "ok" unrepresentable, so this
		// is the strongest available assertion that none is attached.
		await waitFor(() =>
			expect(result.current.gate).toEqual({ gateState: "ok" }),
		);
	});

	it("resolves to account-mismatch — not ok — when the extension is signed into a DIFFERENT Spotify account (the core regression)", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(
			connectedStatus({
				profile: {
					spotifyId: "someone-elses-spotify-id",
					displayName: "not fabio",
					avatarUrl: null,
				},
			}),
		);
		const { result } = renderHook(() => useSpotifyGate(LINKED_SPOTIFY_ID), {
			wrapper,
		});
		await waitFor(() =>
			expect(result.current.gate.gateState).toBe("account-mismatch"),
		);
		// Never "ok" — this is the exact state that must block CreateBar's CTA.
		expect(result.current.gate.gateState).not.toBe("ok");
		expect(result.current.gate).toEqual({
			gateState: "account-mismatch",
			mismatchProfile: {
				spotifyId: "someone-elses-spotify-id",
				displayName: "not fabio",
				avatarUrl: null,
			},
		});
	});

	it("unpaired stays ok for a linked account — pairing only gates sync upload, never the extension's Spotify commands the studio issues", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(
			connectedStatus({
				paired: false,
				profile: {
					spotifyId: LINKED_SPOTIFY_ID,
					displayName: "fabio",
					avatarUrl: null,
				},
			}),
		);
		const { result } = renderHook(() => useSpotifyGate(LINKED_SPOTIFY_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.gate.gateState).toBe("ok"));
	});

	it("unverifiable (profile missing) stays ok for a linked account, per invariant 6 — never a hard conflict", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(
			connectedStatus({ paired: true, profile: null }),
		);
		const { result } = renderHook(() => useSpotifyGate(LINKED_SPOTIFY_ID), {
			wrapper,
		});
		await waitFor(() => expect(result.current.gate.gateState).toBe("ok"));
	});
});

describe("useSpotifyGate — anti-flicker (invariant 4)", () => {
	// Both tests in this block used to assert the mid-flight state with a bare
	// (non-waitFor) `expect` right after triggering `recheck()`. That's vacuous:
	// TanStack Query's notifyManager defers a query update's observer
	// notification via `setTimeout(…, 0)`, so the bare assertion ran BEFORE
	// React ever re-rendered with the in-flight `isFetching: true` state — it
	// only ever observed the stale PRE-recheck render, the same value whether
	// the selector correctly ignores `isFetching` or wrongly derives "checking"
	// from it. Verified by deliberately introducing that exact bug (mapping
	// `verdict` to `{ kind: "checking" }` whenever `query.isFetching` in
	// useExtensionConnection.ts) and re-running this file: both tests below
	// still passed unmodified, while the reportGateFailure tests further down
	// (which do go through a waitFor) correctly failed. Fixed by using fake
	// timers and explicitly advancing past the deferred notify BEFORE
	// resolving the pending fetch, so the mid-flight assertion genuinely
	// exercises the re-render this invariant is about. Re-ran the same bug
	// injection against the rewritten tests below and confirmed both now fail;
	// reverted the injection afterward.
	it("a settled ok never downgrades to checking while a background refetch is in flight", async () => {
		vi.useFakeTimers();
		try {
			mockIsExtensionInstalled.mockResolvedValue(true);
			mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
			const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(result.current.gate.gateState).toBe("ok");

			// Hang the next fetch so we can observe the mid-flight state — this is
			// exactly the "transient fetching state" the invariant is about:
			// TanStack Query keeps serving the previous `ok` data for the whole
			// time this is pending, so a selector that (wrongly) mapped
			// isFetching/missing-data to "checking" would flip here.
			const pending = deferred<SpotifyAccountStatus>();
			mockGetSpotifyAccountStatus.mockReturnValueOnce(pending.promise);

			let recheckPromise!: Promise<void>;
			act(() => {
				recheckPromise = result.current.recheck();
			});

			// Flush the deferred notify so React actually re-renders reflecting
			// the query's in-flight state (data still the previous `ok` result,
			// isFetching: true) — `pending` is still unresolved at this point, so
			// this genuinely exercises the mid-flight render, not a stale one.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(result.current.gate.gateState).toBe("ok");

			await act(async () => {
				pending.resolve(connectedStatus());
				await recheckPromise;
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(result.current.gate.gateState).toBe("ok");
		} finally {
			vi.useRealTimers();
		}
	});

	it("a settled ok never downgrades to checking even when the background refetch resolves unhealthy — it goes straight to the new verdict, never through checking", async () => {
		vi.useFakeTimers();
		try {
			mockIsExtensionInstalled.mockResolvedValue(true);
			mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
			const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(result.current.gate.gateState).toBe("ok");

			const pending = deferred<SpotifyAccountStatus>();
			mockGetSpotifyAccountStatus.mockReturnValueOnce(pending.promise);

			let recheckPromise!: Promise<void>;
			act(() => {
				recheckPromise = result.current.recheck();
			});

			// Same genuine mid-flight observation as the test above, before this
			// fetch resolves unhealthy.
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(result.current.gate.gateState).toBe("ok");

			await act(async () => {
				pending.resolve(connectedStatus({ connected: false }));
				await recheckPromise;
				await vi.advanceTimersByTimeAsync(0);
			});
			// Landed straight on the new result — never observed as "checking" in
			// between (the mid-flight assertion above proved that genuinely, not
			// vacuously), and this final value is the real new verdict, not a
			// stale ok either.
			expect(result.current.gate.gateState).toBe("reconnect-required");
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("useSpotifyGate — refetchOnWindowFocus", () => {
	it("re-checks when the tab regains focus once the shared query has gone stale", async () => {
		vi.useFakeTimers();
		try {
			mockIsExtensionInstalled.mockResolvedValue(true);
			mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
			const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(result.current.gate.gateState).toBe("ok");
			const callsAtOk = mockIsExtensionInstalled.mock.calls.length;

			// The shared query's staleTime (3s) gates refetchOnWindowFocus — focus
			// alone doesn't refetch fresh data, only stale data (see
			// connection-state.ts's extensionConnectionQueryOptions).
			await act(async () => {
				await vi.advanceTimersByTimeAsync(3_000);
			});
			expect(mockIsExtensionInstalled.mock.calls.length).toBe(callsAtOk);

			act(() => {
				focusManager.setFocused(false);
				focusManager.setFocused(true);
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});

			expect(mockIsExtensionInstalled.mock.calls.length).toBeGreaterThan(
				callsAtOk,
			);
			expect(result.current.gate.gateState).toBe("ok");
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not re-check on focus while the query is still fresh", async () => {
		vi.useFakeTimers();
		try {
			mockIsExtensionInstalled.mockResolvedValue(true);
			mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
			const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(result.current.gate.gateState).toBe("ok");
			const callsAtOk = mockIsExtensionInstalled.mock.calls.length;

			act(() => {
				focusManager.setFocused(false);
				focusManager.setFocused(true);
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});

			expect(mockIsExtensionInstalled.mock.calls.length).toBe(callsAtOk);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("useSpotifyGate — reportGateFailure", () => {
	it("reconnect-required pushes a sticky auth failure that another consumer of the same QueryClient sees", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
		const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
		await waitFor(() => expect(result.current.gate.gateState).toBe("ok"));

		const other = renderHook(() => useExtensionConnection(null), { wrapper });
		await waitFor(() =>
			expect(other.result.current.verdict).toEqual({ kind: "ok" }),
		);

		act(() => {
			result.current.reportGateFailure("reconnect-required");
		});

		expect(result.current.gate.gateState).toBe("reconnect-required");
		await waitFor(() =>
			expect(other.result.current.verdict).toEqual({
				kind: "spotify-disconnected",
			}),
		);
	});

	it("reconnect-required survives a following poll that still reports hasToken: true (invariant 7)", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
		const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
		await waitFor(() => expect(result.current.gate.gateState).toBe("ok"));

		act(() => {
			result.current.reportGateFailure("reconnect-required");
		});
		expect(result.current.gate.gateState).toBe("reconnect-required");

		// reportSpotifyAuthFailure invalidates the query, which triggers a
		// confirming refetch. The extension's local hasToken check can't see a
		// Spotify-side rejection, so the mock keeps answering "connected" — the
		// sticky authFailedAt flag (not this refetch's data) is what must keep
		// the gate at reconnect-required.
		await waitFor(() =>
			expect(mockGetSpotifyAccountStatus.mock.calls.length).toBeGreaterThan(1),
		);
		expect(result.current.gate.gateState).toBe("reconnect-required");
	});

	it("extension-unavailable is a synchronous push — the gate flips immediately, not after a refetch", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
		const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
		await waitFor(() => expect(result.current.gate.gateState).toBe("ok"));

		// Freeze the extension mocks so any refetch this call might trigger
		// would never resolve within the test — proving the flip doesn't depend
		// on one landing.
		mockIsExtensionInstalled.mockReturnValue(new Promise(() => {}));

		act(() => {
			result.current.reportGateFailure("extension-unavailable");
		});

		// "Synchronous" describes the production write (a plain setQueryData,
		// not invalidate+await refetch) — the React re-render itself still lands
		// via notifyManager's setTimeout(…, 0), so this is a waitFor, but nothing
		// here depends on the frozen `isExtensionInstalled` mock ever resolving.
		await waitFor(() =>
			expect(result.current.gate.gateState).toBe("extension-unavailable"),
		);
	});

	it("extension-unavailable's sticky override is cleared by an explicit recheck once the extension is confirmed reachable again (finding 4)", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
		const { result } = renderHook(() => useSpotifyGate(null), { wrapper });
		await waitFor(() => expect(result.current.gate.gateState).toBe("ok"));

		act(() => {
			result.current.reportGateFailure("extension-unavailable");
		});
		await waitFor(() =>
			expect(result.current.gate.gateState).toBe("extension-unavailable"),
		);

		// The user reinstalled/re-enabled the extension in another tab and hits
		// "Check again". Without clearing the sticky store first, this would
		// stay stuck at extension-unavailable forever — the override forces
		// installed:false regardless of what a fresh poll finds, and nothing
		// else in this flow would ever un-stick it (unlike a Spotify auth
		// failure, "extension unreachable" has no repairConnection branch of
		// its own to clear it from).
		await act(async () => {
			await result.current.recheck();
		});

		await waitFor(() => expect(result.current.gate.gateState).toBe("ok"));
	});
});
