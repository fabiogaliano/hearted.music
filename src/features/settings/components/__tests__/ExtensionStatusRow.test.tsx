/**
 * Tests for ExtensionStatusRow — the Connections row in Settings, and the
 * sixth detection path task 06 migrates
 * (docs/plans/extension-connection-service/06-cleanup.md). The old version
 * called isExtensionInstalled() once on mount and never again, so installing
 * the extension while Settings stayed open still read "not detected" for the
 * life of the page. Now it reads the shared connection query, which re-polls
 * while unhealthy — the last test here pins that the row actually flips
 * without a remount, not just that the initial read is correct.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyAccountStatus } from "@/lib/extension/detect";
import { act, render, screen } from "@/test/utils/render";
import { ExtensionStatusRow } from "../ExtensionStatusRow";

const { mockIsExtensionInstalled, mockGetSpotifyAccountStatus } = vi.hoisted(
	() => ({
		mockIsExtensionInstalled: vi.fn(),
		mockGetSpotifyAccountStatus: vi.fn(),
	}),
);

// Same seam connection-state.test.ts/useSpotifyGate.test.tsx mock — this
// component reads the shared query, not detect.ts, directly.
vi.mock("@/lib/extension/detect", () => ({
	isExtensionInstalled: () => mockIsExtensionInstalled(),
	getSpotifyAccountStatus: () => mockGetSpotifyAccountStatus(),
}));

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

let queryClient: QueryClient;

function withQueryClient(ui: ReactElement) {
	return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	mockIsExtensionInstalled.mockReset();
	mockGetSpotifyAccountStatus.mockReset();
});

afterEach(() => {
	queryClient.clear();
	vi.useRealTimers();
});

describe("ExtensionStatusRow", () => {
	it("shows the checking copy while the first PING is pending", () => {
		mockIsExtensionInstalled.mockReturnValue(new Promise(() => {}));
		render(withQueryClient(<ExtensionStatusRow />));
		expect(screen.getByText("Looking for the extension…")).toBeInTheDocument();
		expect(screen.getByText("Checking")).toBeInTheDocument();
	});

	it("reports not detected when PING never answers", async () => {
		mockIsExtensionInstalled.mockResolvedValue(false);
		render(withQueryClient(<ExtensionStatusRow />));
		expect(
			await screen.findByText("Chrome extension not detected"),
		).toBeInTheDocument();
		expect(screen.getByText("Not detected")).toBeInTheDocument();
		expect(mockGetSpotifyAccountStatus).not.toHaveBeenCalled();
	});

	it("reports connected once PING answers, even if SPOTIFY_STATUS doesn't (invariant 6 — install status only, not identity)", async () => {
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(null);
		render(withQueryClient(<ExtensionStatusRow />));
		expect(
			await screen.findByText("Chrome extension is connected"),
		).toBeInTheDocument();
		expect(screen.getByText("Connected")).toBeInTheDocument();
	});

	it("stays fresh: an install detected mid-page-life flips the row without a remount (the sixth-detection-path fix)", async () => {
		vi.useFakeTimers();
		mockIsExtensionInstalled.mockResolvedValue(false);
		render(withQueryClient(<ExtensionStatusRow />));

		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		expect(
			screen.getByText("Chrome extension not detected"),
		).toBeInTheDocument();

		// Extension gets installed while this page is still open — no remount,
		// nothing re-invokes the component. The old version would show
		// "not detected" forever; the shared query keeps polling while
		// unhealthy (connection-state.ts's 6s unhealthy interval) and picks
		// this up on its own.
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(connectedStatus());
		await act(async () => {
			await vi.advanceTimersByTimeAsync(6_000);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(100);
		});

		expect(
			screen.getByText("Chrome extension is connected"),
		).toBeInTheDocument();
		expect(screen.getByText("Connected")).toBeInTheDocument();
	});
});
