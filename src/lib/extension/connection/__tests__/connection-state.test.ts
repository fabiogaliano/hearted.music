import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpotifyAccountStatus } from "../../detect";

const { mockIsExtensionInstalled, mockGetSpotifyAccountStatus } = vi.hoisted(
	() => ({
		mockIsExtensionInstalled: vi.fn(),
		mockGetSpotifyAccountStatus: vi.fn(),
	}),
);

vi.mock("../../detect", () => ({
	isExtensionInstalled: () => mockIsExtensionInstalled(),
	getSpotifyAccountStatus: () => mockGetSpotifyAccountStatus(),
}));

import {
	getAuthFailedAt,
	resetAuthFailedAtForTests,
} from "../auth-failed-store";
import {
	extensionConnectionKey,
	extensionConnectionQueryOptions,
	fetchExtensionConnection,
	type PolledConnection,
} from "../connection-state";
import {
	reportExtensionUnreachable,
	reportSpotifyAuthFailure,
} from "../report-failure";
import {
	getUnreachableAt,
	resetUnreachableAtForTests,
} from "../unreachable-store";
import { deriveConnectionVerdict } from "../verdict";

function status(
	overrides: Partial<SpotifyAccountStatus>,
): SpotifyAccountStatus {
	return {
		connected: true,
		paired: true,
		profile: { spotifyId: "linked-1", displayName: "fabio", avatarUrl: null },
		...overrides,
	};
}

afterEach(() => {
	mockIsExtensionInstalled.mockReset();
	mockGetSpotifyAccountStatus.mockReset();
	resetAuthFailedAtForTests();
	resetUnreachableAtForTests();
});

describe("fetchExtensionConnection", () => {
	it("returns the not-installed shape when PING doesn't answer", async () => {
		mockIsExtensionInstalled.mockResolvedValue(false);

		const result = await fetchExtensionConnection();

		expect(result).toEqual({
			installed: false,
			spotifyConnected: false,
			paired: null,
			profile: null,
		});
		expect(mockGetSpotifyAccountStatus).not.toHaveBeenCalled();
	});

	it("reports installed: true when PING answers but SPOTIFY_STATUS doesn't (invariant 6 regression guard)", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(null);

		const result = await fetchExtensionConnection();

		expect(result).toEqual({
			installed: true,
			spotifyConnected: false,
			paired: null,
			profile: null,
		});
	});

	it("passes the full status through when both calls answer", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(status({}));

		const result = await fetchExtensionConnection();

		expect(result).toEqual({
			installed: true,
			spotifyConnected: true,
			paired: true,
			profile: { spotifyId: "linked-1", displayName: "fabio", avatarUrl: null },
		});
	});
});

describe("extensionConnectionQueryOptions", () => {
	// refetchInterval only reads `query.state.data` (plus the authFailedAt
	// store) — a minimal stub is enough and sidesteps needing a real,
	// fully-typed Query instance (same pattern as
	// match.card-actions.test.ts's captureRefetchInterval).
	function refetchIntervalOf(
		options: ReturnType<typeof extensionConnectionQueryOptions>,
	) {
		const { refetchInterval } = options;
		if (typeof refetchInterval !== "function") {
			throw new Error("expected refetchInterval to be a function");
		}
		return (data: PolledConnection | undefined) =>
			refetchInterval({ state: { data } } as Parameters<
				typeof refetchInterval
			>[0]);
	}

	it("keeps polling while the connection is unhealthy", () => {
		const refetchInterval = refetchIntervalOf(
			extensionConnectionQueryOptions(),
		);

		expect(
			refetchInterval({
				installed: true,
				spotifyConnected: false,
				paired: true,
				profile: null,
			}),
		).toBe(6_000);
	});

	it("stops polling once the connection is fully healthy", () => {
		const refetchInterval = refetchIntervalOf(
			extensionConnectionQueryOptions(),
		);

		expect(
			refetchInterval({
				installed: true,
				spotifyConnected: true,
				paired: true,
				profile: {
					spotifyId: "linked-1",
					displayName: "fabio",
					avatarUrl: null,
				},
			}),
		).toBe(false);
	});

	it("keeps polling while authFailedAt is sticky in its own store, even with spotifyConnected: true on the polled data", () => {
		const refetchInterval = refetchIntervalOf(
			extensionConnectionQueryOptions(),
		);
		const qc = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		qc.setQueryData(extensionConnectionKey, {
			installed: true,
			spotifyConnected: true,
			paired: true,
			profile: null,
		});
		reportSpotifyAuthFailure(qc);

		expect(
			refetchInterval({
				installed: true,
				spotifyConnected: true,
				paired: true,
				profile: null,
			}),
		).toBe(6_000);
	});

	it("keeps polling while unreachableAt is sticky in its own store, even with installed/spotifyConnected: true on the polled data (finding 4)", () => {
		const refetchInterval = refetchIntervalOf(
			extensionConnectionQueryOptions(),
		);
		const qc = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		qc.setQueryData(extensionConnectionKey, {
			installed: true,
			spotifyConnected: true,
			paired: true,
			profile: null,
		});
		reportExtensionUnreachable(qc);

		expect(
			refetchInterval({
				installed: true,
				spotifyConnected: true,
				paired: true,
				profile: null,
			}),
		).toBe(6_000);
	});

	it("keeps polling before the first fetch settles (no data yet)", () => {
		const refetchInterval = refetchIntervalOf(
			extensionConnectionQueryOptions(),
		);

		expect(refetchInterval(undefined)).toBe(6_000);
	});

	it("does not fetch merely from constructing query options (lazy polling) — a real QueryObserver only fetches once subscribed, and stops polling once unsubscribed", async () => {
		vi.useFakeTimers();
		try {
			mockIsExtensionInstalled.mockResolvedValue(true);
			// Stays unhealthy for the whole test so the interval keeps firing —
			// isolates "does the subscriber lifecycle drive fetching at all" from
			// the separate healthy/unhealthy branching already covered above.
			mockGetSpotifyAccountStatus.mockResolvedValue(
				status({ connected: false }),
			);

			const qc = new QueryClient({
				defaultOptions: { queries: { retry: false } },
			});
			const options = extensionConnectionQueryOptions();

			// Constructing the options — what the old vacuous test asserted — must
			// not fetch anything on its own.
			expect(mockIsExtensionInstalled).not.toHaveBeenCalled();

			const observer = new QueryObserver(qc, options);
			const unsubscribe = observer.subscribe(() => {});

			// Flush the subscribe-triggered initial fetch.
			await vi.advanceTimersByTimeAsync(0);
			expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(1);

			// The conditional refetchInterval must actually be armed while
			// subscribed and unhealthy.
			await vi.advanceTimersByTimeAsync(6_000);
			expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(2);

			unsubscribe();
			const callsAtUnsubscribe = mockIsExtensionInstalled.mock.calls.length;
			await vi.advanceTimersByTimeAsync(30_000);
			expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(
				callsAtUnsubscribe,
			);
		} finally {
			vi.useRealTimers();
		}
	});

	// Finding 1: polling resumption on a push is load-bearing, not cosmetic.
	// Drives a real, subscribed QueryObserver from idle-and-healthy
	// (refetchInterval: false) through a push landing, and asserts a fetch
	// fires again without waiting out any interval. If report-failure.ts's
	// `invalidateQueries` call is removed, this test fails — verified by hand
	// while making this change (temporarily deleted the call, watched this
	// test fail with only 1 fetch recorded after the push, restored it).
	it("resumes an idle poll on a push (finding 1 regression guard)", async () => {
		vi.useFakeTimers();
		try {
			mockIsExtensionInstalled.mockResolvedValue(true);
			mockGetSpotifyAccountStatus.mockResolvedValue(status({}));

			const qc = new QueryClient({
				defaultOptions: { queries: { retry: false } },
			});
			const observer = new QueryObserver(qc, extensionConnectionQueryOptions());
			const unsubscribe = observer.subscribe(() => {});

			// Initial fetch settles fully healthy.
			await vi.advanceTimersByTimeAsync(0);
			expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(1);
			expect(observer.getCurrentResult().data).toMatchObject({
				installed: true,
				spotifyConnected: true,
			});

			// Idle + healthy: refetchInterval is false, so no poll fires even
			// well past the 6s unhealthy cadence.
			await vi.advanceTimersByTimeAsync(10_000);
			expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(1);

			// A live command elsewhere pushes an auth failure while the query is
			// sitting idle. The extension's local hasToken check still can't see
			// the rejection, so the mock keeps reporting connected: true — this
			// isolates "does the push alone resume polling" from any change in
			// the poll's own data.
			reportSpotifyAuthFailure(qc);

			// The invalidate's refetch is asynchronous but not interval-gated —
			// it must fire well before another 6s would have to pass.
			await vi.advanceTimersByTimeAsync(0);
			expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(2);

			// And polling stays resumed: authFailedAt is still sticky in the
			// store, so the next 6s tick fires too, even though the polled data
			// alone still looks healthy.
			await vi.advanceTimersByTimeAsync(6_000);
			expect(mockIsExtensionInstalled).toHaveBeenCalledTimes(3);

			unsubscribe();
		} finally {
			vi.useRealTimers();
		}
	});
});

// Finding 1 regression guard: the sticky authFailedAt must survive a push
// landing while the connection query's fetch is still in flight. Before the
// fix, the fetcher captured `previous` synchronously at fetch start and
// merged it back in after awaiting two extension round-trips; a push
// arriving in that window got silently overwritten when the fetch committed
// with its stale pre-push snapshot.
describe("extensionConnectionQueryOptions + reportSpotifyAuthFailure (lost-update regression guard)", () => {
	it("a push landing mid-flight survives the in-flight fetch's commit", async () => {
		const qc = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		qc.setQueryData(extensionConnectionKey, {
			installed: true,
			spotifyConnected: true,
			paired: true,
			profile: { spotifyId: "linked-1", displayName: "fabio", avatarUrl: null },
		});

		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockImplementation(async () => {
			// A live command elsewhere in the app observes AUTH_REQUIRED while
			// this poll is still in flight and pushes straight into shared state.
			reportSpotifyAuthFailure(qc);
			// The extension's local hasToken check can't see a Spotify-side
			// rejection, so the poll itself still reports connected: true — this
			// is exactly the scenario invariant 7 exists for.
			return status({ connected: true });
		});

		// staleTime: 0 forces an actual fetch despite the just-seeded, still-fresh
		// cache entry — the reviewer's repro seeds healthy data, then starts a
		// fetch that races a push, and `fetchQuery` would otherwise skip the
		// network call entirely and serve the fresh cached value.
		await qc.fetchQuery({ ...extensionConnectionQueryOptions(), staleTime: 0 });

		const authFailedAt = getAuthFailedAt();
		expect(authFailedAt).not.toBeNull();

		const polled = qc.getQueryData<PolledConnection>(extensionConnectionKey);
		expect(polled).toBeDefined();
		const connection = polled && { ...polled, authFailedAt };
		expect(deriveConnectionVerdict(connection, "linked-1")).toEqual({
			kind: "spotify-disconnected",
		});

		// And polling must not have stopped: a "healthy" reading purely off the
		// poll's own fields would otherwise turn refetchInterval off, which is
		// exactly how the original bug went silent (stuck reporting "ok" forever).
		const { refetchInterval } = extensionConnectionQueryOptions();
		if (typeof refetchInterval !== "function") {
			throw new Error("expected refetchInterval to be a function");
		}
		expect(
			refetchInterval({ state: { data: polled } } as Parameters<
				typeof refetchInterval
			>[0]),
		).toBe(6_000);
	});
});

// Finding 4 regression guard: the sticky unreachableAt must survive a push
// landing while the connection query's own fetch is still in flight — the
// exact race the reviewer flagged (reportExtensionUnreachable had no
// sticky-store protection, unlike reportSpotifyAuthFailure). Before the fix,
// the forced installed:false/spotifyConnected:false lived only on the polled
// cache entry via setQueryData; an in-flight fetch resolving afterward with
// healthy data replaced that entry wholesale and silently clobbered it back
// to "ok".
describe("extensionConnectionQueryOptions + reportExtensionUnreachable (lost-update regression guard, finding 4)", () => {
	it("a push landing mid-flight survives the in-flight fetch's commit", async () => {
		const qc = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		qc.setQueryData(extensionConnectionKey, {
			installed: true,
			spotifyConnected: true,
			paired: true,
			profile: { spotifyId: "linked-1", displayName: "fabio", avatarUrl: null },
		});

		mockIsExtensionInstalled.mockImplementation(async () => {
			// A first-hand PING failure elsewhere (e.g. the studio gate's submit
			// preflight) pushes straight into shared state while this poll's own
			// PING is still in flight.
			reportExtensionUnreachable(qc);
			// The poll's own PING still answers "installed" — it started before
			// the push and has no way to know about it. This is exactly the
			// scenario the sticky store exists for.
			return true;
		});
		mockGetSpotifyAccountStatus.mockResolvedValue(status({}));

		// staleTime: 0 forces an actual fetch despite the just-seeded, still-fresh
		// cache entry — seeds healthy data, then starts a fetch that races the
		// push, mirroring the authFailedAt regression guard above.
		await qc.fetchQuery({ ...extensionConnectionQueryOptions(), staleTime: 0 });

		const unreachableAt = getUnreachableAt();
		expect(unreachableAt).not.toBeNull();

		const polled = qc.getQueryData<PolledConnection>(extensionConnectionKey);
		expect(polled).toBeDefined();
		// Mirrors useExtensionConnection's merge: the sticky override forces
		// installed/spotifyConnected false regardless of what the raced fetch
		// committed to the polled cache.
		const connection = polled && {
			...polled,
			installed: false,
			spotifyConnected: false,
			authFailedAt: getAuthFailedAt(),
		};
		expect(deriveConnectionVerdict(connection, "linked-1")).toEqual({
			kind: "extension-missing",
		});

		// And polling must not have stopped: a "healthy" reading purely off the
		// poll's own fields would otherwise turn refetchInterval off, silently
		// going quiet the same way the original bug did.
		const { refetchInterval } = extensionConnectionQueryOptions();
		if (typeof refetchInterval !== "function") {
			throw new Error("expected refetchInterval to be a function");
		}
		expect(
			refetchInterval({ state: { data: polled } } as Parameters<
				typeof refetchInterval
			>[0]),
		).toBe(6_000);
	});
});
