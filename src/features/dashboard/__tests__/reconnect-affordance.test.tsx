/**
 * Regression test for the two-reconnects bug (see
 * docs/plans/extension-connection-service/README.md's Revision log): a fresh,
 * unpaired extension install used to show the banner's "Reconnect" for
 * pairing, then a second "Reconnect Spotify" button in the sync control once
 * pairing settled — two sequential CTAs for one problem.
 *
 * Renders ExtensionAccountBanner and DashboardSyncStatus side by side, both
 * driven by the same verdict (as Dashboard.tsx wires them), and asserts the
 * dashboard never shows more than one reconnect-shaped button at a time.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionVerdict } from "@/lib/extension/connection/verdict";
import { render, screen, userEvent } from "@/test/utils/render";
import { DashboardSyncStatus } from "../components/DashboardSyncStatus";
import { ExtensionAccountBanner } from "../components/ExtensionAccountBanner";

const mockGetSpotifyConnectionStatus = vi.fn();
const mockRequestExtensionSync = vi.fn();
const mockExpectLoginReturn = vi.fn();
const mockPairExtension = vi.fn();
const mockUseExtensionSyncStatus = vi.fn();

vi.mock("@/lib/extension/detect", () => ({
	getSpotifyConnectionStatus: () => mockGetSpotifyConnectionStatus(),
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

function makeQueryClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function TestWrapper({
	children,
	queryClient,
}: {
	children: ReactNode;
	queryClient: QueryClient;
}) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

function renderDashboardArea(
	ui: ReactElement,
	queryClient = makeQueryClient(),
) {
	return render(<TestWrapper queryClient={queryClient}>{ui}</TestWrapper>);
}

function DashboardConnectionSurfaces({
	verdict,
	linkedSpotifyId,
}: {
	verdict: ConnectionVerdict;
	linkedSpotifyId: string | null;
}) {
	return (
		<>
			<ExtensionAccountBanner
				verdict={verdict}
				linkedSpotifyId={linkedSpotifyId}
				accountDisplayName="fabio"
			/>
			<DashboardSyncStatus
				accountId="acct-1"
				lastSyncText="Last synced 2 hours ago"
				verdict={verdict}
				linkedSpotifyId={linkedSpotifyId}
			/>
		</>
	);
}

beforeEach(() => {
	mockGetSpotifyConnectionStatus.mockReset().mockResolvedValue(true);
	mockRequestExtensionSync.mockReset();
	mockExpectLoginReturn.mockReset().mockResolvedValue(true);
	mockPairExtension.mockReset().mockResolvedValue({ ok: true });
	mockUseExtensionSyncStatus.mockReset().mockReturnValue({ sync: null });
	vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("dashboard reconnect affordance — two-reconnects regression guard", () => {
	it.each([
		{ kind: "unpaired" as const },
		{ kind: "spotify-disconnected" as const },
		{
			kind: "mismatch" as const,
			extensionProfile: {
				spotifyId: "wrong-id",
				displayName: "alex@work",
				avatarUrl: null,
			},
		},
	])("surfaces exactly one reconnect button for a linked account's $kind verdict", (verdict) => {
		renderDashboardArea(
			<DashboardConnectionSurfaces
				verdict={verdict}
				linkedSpotifyId="spotify-1"
			/>,
		);

		const buttons = screen.getAllByRole("button");
		expect(buttons).toHaveLength(1);
		// The one button is the banner's — the sync control renders only its
		// "sync paused" status line (see DashboardSyncControl's `paused` case).
		expect(screen.getByText(/sync paused/i)).toBeInTheDocument();
	});

	it("a fresh unpaired install resolves in that one click: Reconnect pairs, and the control settles to paused without ever showing its own CTA", async () => {
		const user = userEvent.setup();
		renderDashboardArea(
			<DashboardConnectionSurfaces
				verdict={{ kind: "unpaired" }}
				linkedSpotifyId="spotify-1"
			/>,
		);

		expect(screen.getAllByRole("button")).toHaveLength(1);
		await user.click(screen.getByRole("button", { name: /reconnect/i }));

		expect(mockPairExtension).toHaveBeenCalledTimes(1);
		// Still exactly one control on screen afterwards — no second CTA appears
		// once pairing settles (the historical bug this test guards against).
		expect(screen.getAllByRole("button")).toHaveLength(1);
	});

	it("shows no reconnect button anywhere once the verdict is ok", () => {
		renderDashboardArea(
			<DashboardConnectionSurfaces
				verdict={{ kind: "ok" }}
				linkedSpotifyId="spotify-1"
			/>,
		);

		// Only the control's own "Sync" CTA remains — no reconnect affordance.
		const buttons = screen.getAllByRole("button");
		expect(buttons).toHaveLength(1);
		expect(buttons[0]).toHaveTextContent(/^sync$/i);
	});
});
