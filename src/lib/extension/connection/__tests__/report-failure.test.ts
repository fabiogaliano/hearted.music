import { QueryClient } from "@tanstack/react-query";
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
	fetchExtensionConnection,
} from "../connection-state";
import {
	reportExtensionUnreachable,
	reportSpotifyAuthFailure,
	reportSpotifyAuthSuccess,
} from "../report-failure";

function connected(): {
	installed: boolean;
	spotifyConnected: boolean;
	paired: boolean | null;
	profile: SpotifyAccountStatus["profile"];
} {
	return {
		installed: true,
		spotifyConnected: true,
		paired: true,
		profile: { spotifyId: "linked-1", displayName: "fabio", avatarUrl: null },
	};
}

function client() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
	vi.restoreAllMocks();
	mockIsExtensionInstalled.mockReset();
	mockGetSpotifyAccountStatus.mockReset();
	resetAuthFailedAtForTests();
});

describe("reportSpotifyAuthFailure", () => {
	it("stamps authFailedAt in the store and flips spotifyConnected on the polled cache", () => {
		const qc = client();
		qc.setQueryData(extensionConnectionKey, connected());

		reportSpotifyAuthFailure(qc);

		expect(getAuthFailedAt()).toEqual(expect.any(Number));
		expect(qc.getQueryData(extensionConnectionKey)).toMatchObject({
			spotifyConnected: false,
		});
	});

	it("invalidates the connection query — load-bearing for resuming an idle poll (finding 1)", () => {
		// The sticky authFailedAt write itself is synchronous (asserted above)
		// and doesn't depend on this. The invalidate exists for a different
		// reason: it's what rearms a subscribed observer's refetchInterval when
		// the query was idle-and-healthy at the moment the push lands — see
		// report-failure.ts's header comment and
		// connection-state.test.ts's "resumes an idle poll on a push" test for
		// the end-to-end proof via a real QueryObserver.
		const qc = client();
		qc.setQueryData(extensionConnectionKey, connected());
		const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

		reportSpotifyAuthFailure(qc);

		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: extensionConnectionKey,
		});
	});

	it("still stamps authFailedAt when the connection has never been fetched (no prior cache entry) — the store doesn't need a seed", () => {
		const qc = client();

		reportSpotifyAuthFailure(qc);

		// The polled-cache merge is still a no-op without a prior entry (nothing
		// to merge onto), but the sticky flag itself — the field the verdict
		// actually keys off — is not gated on that. This is what resolves the
		// phase-01 forward risk in DECISIONS.md: a live command failing on a
		// page that never mounted the connection query no longer loses the push.
		expect(qc.getQueryData(extensionConnectionKey)).toBeUndefined();
		expect(getAuthFailedAt()).toEqual(expect.any(Number));
	});

	it("is not resurrected by a subsequent poll that still reports hasToken: true (invariant 7)", async () => {
		const qc = client();
		qc.setQueryData(extensionConnectionKey, connected());

		reportSpotifyAuthFailure(qc);
		const stampedAt = getAuthFailedAt();
		expect(stampedAt).not.toBeNull();

		// Simulate the next poll tick: the extension's local hasToken check still
		// reads true (it can't see the Spotify-side rejection), so the fetcher
		// reports connected: true again. The fetcher no longer even looks at
		// authFailedAt — it lives entirely outside the polled payload now.
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue({
			connected: true,
			paired: true,
			profile: { spotifyId: "linked-1", displayName: "fabio", avatarUrl: null },
		} satisfies SpotifyAccountStatus);
		const polled = await fetchExtensionConnection();

		expect(polled.spotifyConnected).toBe(true);
		expect(getAuthFailedAt()).toBe(stampedAt);
	});
});

describe("reportSpotifyAuthSuccess", () => {
	it("clears a sticky authFailedAt", () => {
		const qc = client();
		qc.setQueryData(extensionConnectionKey, {
			...connected(),
			spotifyConnected: false,
		});
		reportSpotifyAuthFailure(qc);
		expect(getAuthFailedAt()).not.toBeNull();

		reportSpotifyAuthSuccess(qc);

		expect(getAuthFailedAt()).toBeNull();
	});

	it("clears the store even when there is no prior cache entry", () => {
		const qc = client();
		reportSpotifyAuthFailure(qc);
		expect(getAuthFailedAt()).not.toBeNull();

		reportSpotifyAuthSuccess(qc);

		expect(getAuthFailedAt()).toBeNull();
	});
});

describe("reportExtensionUnreachable", () => {
	it("forces installed and spotifyConnected to false", () => {
		const qc = client();
		qc.setQueryData(extensionConnectionKey, connected());

		reportExtensionUnreachable(qc);

		expect(qc.getQueryData(extensionConnectionKey)).toMatchObject({
			installed: false,
			spotifyConnected: false,
		});
	});

	it("preserves paired/profile so a real reinstall detection isn't required to recover them", () => {
		const qc = client();
		qc.setQueryData(extensionConnectionKey, connected());

		reportExtensionUnreachable(qc);

		expect(qc.getQueryData(extensionConnectionKey)).toMatchObject({
			paired: true,
			profile: { spotifyId: "linked-1" },
		});
	});
});
