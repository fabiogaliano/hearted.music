/**
 * Tests for ExtensionAccountBanner — the dashboard's single reconnect home
 * (task 03). Covers the verdict → copy/button mapping, that a click always
 * delegates to repairConnection (never a bespoke open/pair sequence), that a
 * rejecting repair doesn't leave the button stuck disabled, and the pre-link
 * suppression rule (linkedSpotifyId === null renders nothing regardless of
 * verdict).
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/utils/render";
import { ExtensionAccountBanner } from "../ExtensionAccountBanner";

const mockGetSpotifyConnectionStatus = vi.fn();
const mockRequestExtensionSync = vi.fn();
const mockExpectLoginReturn = vi.fn();
const mockPairExtension = vi.fn();

vi.mock("@/lib/extension/detect", () => ({
	getSpotifyConnectionStatus: () => mockGetSpotifyConnectionStatus(),
	requestExtensionSync: () => mockRequestExtensionSync(),
	expectLoginReturn: (armToken: string) => mockExpectLoginReturn(armToken),
}));

vi.mock("@/lib/extension/connect", () => ({
	pairExtension: () => mockPairExtension(),
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

function renderBanner(ui: ReactElement, queryClient = makeQueryClient()) {
	return render(<TestWrapper queryClient={queryClient}>{ui}</TestWrapper>);
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	mockGetSpotifyConnectionStatus.mockReset();
	mockRequestExtensionSync.mockReset();
	mockExpectLoginReturn.mockReset().mockResolvedValue(true);
	mockPairExtension.mockReset().mockResolvedValue({ ok: true });
	openSpy = vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("ExtensionAccountBanner — pre-link suppression", () => {
	it("renders nothing when linkedSpotifyId is null, regardless of verdict", () => {
		renderBanner(
			<ExtensionAccountBanner
				verdict={{ kind: "spotify-disconnected" }}
				linkedSpotifyId={null}
				accountDisplayName={null}
			/>,
		);
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});
});

describe("ExtensionAccountBanner — non-actionable verdicts", () => {
	it.each([
		{ kind: "ok" as const },
		{ kind: "checking" as const },
	])("renders nothing for $kind", (verdict) => {
		renderBanner(
			<ExtensionAccountBanner
				verdict={verdict}
				linkedSpotifyId="spotify-1"
				accountDisplayName="fabio"
			/>,
		);
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});
});

describe("ExtensionAccountBanner — unverifiable (invariant 6)", () => {
	it("renders the banner but no button — nothing a click could silently repair", () => {
		renderBanner(
			<ExtensionAccountBanner
				verdict={{ kind: "unverifiable" }}
				linkedSpotifyId="spotify-1"
				accountDisplayName="fabio"
			/>,
		);
		expect(screen.getByRole("status")).toBeInTheDocument();
		expect(screen.queryByRole("button")).not.toBeInTheDocument();
	});
});

describe("ExtensionAccountBanner — mismatch", () => {
	it("renders the switch-account copy and button, and repairs via repairConnection (opens Spotify, never pairs)", async () => {
		const user = userEvent.setup();
		renderBanner(
			<ExtensionAccountBanner
				verdict={{
					kind: "mismatch",
					extensionProfile: {
						spotifyId: "wrong-id",
						displayName: "alex@work",
						avatarUrl: null,
					},
				}}
				linkedSpotifyId="spotify-1"
				accountDisplayName="fabio"
			/>,
		);

		expect(screen.getByText(/alex@work/)).toBeInTheDocument();
		expect(screen.getByText(/fabio/)).toBeInTheDocument();

		await user.click(
			screen.getByRole("button", { name: /switch spotify account/i }),
		);

		expect(openSpy).toHaveBeenCalledTimes(1);
		expect(openSpy.mock.calls[0]?.[0]).toContain("spotify.com");
		// Mismatch's fix is signing in as the right account — pairing can't
		// repair a wrong Spotify identity (invariant 2).
		expect(mockPairExtension).not.toHaveBeenCalled();
	});
});

describe("ExtensionAccountBanner — unpaired", () => {
	it("Reconnect re-pairs silently and never opens Spotify — pairing is what's actually broken here", async () => {
		const user = userEvent.setup();
		renderBanner(
			<ExtensionAccountBanner
				verdict={{ kind: "unpaired" }}
				linkedSpotifyId="spotify-1"
				accountDisplayName="fabio"
			/>,
		);

		await user.click(screen.getByRole("button", { name: /reconnect/i }));

		expect(mockPairExtension).toHaveBeenCalledTimes(1);
		expect(openSpy).not.toHaveBeenCalled();
	});
});

describe("ExtensionAccountBanner — spotify-disconnected, one-click fresh-install repair", () => {
	it("a single Reconnect click opens Spotify *and* re-pairs — the fresh-install case (both credentials gone) resolves in one gesture, fixing the two-reconnects bug", async () => {
		const user = userEvent.setup();
		renderBanner(
			<ExtensionAccountBanner
				verdict={{ kind: "spotify-disconnected" }}
				linkedSpotifyId="spotify-1"
				accountDisplayName="fabio"
			/>,
		);

		await user.click(screen.getByRole("button", { name: /reconnect/i }));

		expect(openSpy).toHaveBeenCalledTimes(1);
		expect(mockPairExtension).toHaveBeenCalledTimes(1);
	});
});

describe("ExtensionAccountBanner — repairConnection rejection", () => {
	it("does not leave the button stuck disabled when pairExtension rejects", async () => {
		mockPairExtension.mockRejectedValue(new Error("network down"));
		const user = userEvent.setup();
		renderBanner(
			<ExtensionAccountBanner
				verdict={{ kind: "unpaired" }}
				linkedSpotifyId="spotify-1"
				accountDisplayName="fabio"
			/>,
		);

		const button = screen.getByRole("button", { name: /reconnect/i });
		await user.click(button);

		// repairConnection's returned promise can genuinely reject — the banner
		// must catch it (never an unhandled rejection) and stop spinning so the
		// user isn't stuck looking at a disabled "Reconnecting…" button forever.
		await screen.findByRole("button", { name: /^reconnect$/i });
		expect(button).not.toBeDisabled();
	});
});
