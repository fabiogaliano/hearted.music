/**
 * Tests for SpotifyReconnectLink's phase-05 extension: activation now routes
 * through repairConnection (open Spotify + silent re-pair) instead of a
 * bespoke arm/window.open sequence, so every surface that renders this anchor
 * (studio's ReconnectPrompt, liked-songs/matching's inline prompts) gets the
 * "unified affordance" the plan calls for — see 05-liked-songs-matching.md.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, userEvent } from "@/test/utils/render";
import { SpotifyReconnectLink } from "../SpotifyReconnectLink";

const mockExpectLoginReturn = vi.fn();
const mockPairExtension = vi.fn();

vi.mock("@/lib/extension/detect", () => ({
	expectLoginReturn: (armToken: string) => mockExpectLoginReturn(armToken),
}));

vi.mock("@/lib/extension/connect", () => ({
	pairExtension: () => mockPairExtension(),
}));

function makeQueryClient() {
	return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderLink(ui: ReactElement) {
	return render(
		<QueryClientProvider client={makeQueryClient()}>{ui}</QueryClientProvider>,
	);
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	mockExpectLoginReturn.mockReset().mockResolvedValue(true);
	mockPairExtension.mockReset().mockResolvedValue({ ok: true });
	openSpy = vi.spyOn(window, "open").mockReturnValue(null);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("SpotifyReconnectLink — left-click activation", () => {
	it("opens Spotify *and* silently re-pairs from a single click (repairConnection's spotify-disconnected branch)", async () => {
		const user = userEvent.setup();
		renderLink(<SpotifyReconnectLink />);

		await user.click(
			screen.getByRole("link", { name: /reconnect to spotify/i }),
		);

		expect(openSpy).toHaveBeenCalledTimes(1);
		expect(openSpy.mock.calls[0]?.[0]).toContain("spotify.com");
		expect(mockPairExtension).toHaveBeenCalledTimes(1);
	});

	it("passes a custom label through unchanged", () => {
		renderLink(<SpotifyReconnectLink label="Reconnect" />);
		expect(
			screen.getByRole("link", { name: /^reconnect/i }),
		).toBeInTheDocument();
	});
});

describe("SpotifyReconnectLink — non-arming activations (shouldArmOnEvent)", () => {
	it("does not open Spotify or re-pair on a right-click (button=2 dispatches contextmenu, not click/auxclick)", async () => {
		renderLink(<SpotifyReconnectLink />);
		const link = screen.getByRole("link", { name: /reconnect to spotify/i });

		link.dispatchEvent(
			new MouseEvent("auxclick", {
				button: 2,
				bubbles: true,
				cancelable: true,
			}),
		);

		expect(openSpy).not.toHaveBeenCalled();
		expect(mockPairExtension).not.toHaveBeenCalled();
	});
});

describe("SpotifyReconnectLink — repairConnection rejection", () => {
	it("does not throw / leave an unhandled rejection when pairExtension rejects", async () => {
		mockPairExtension.mockRejectedValue(new Error("network down"));
		const user = userEvent.setup();
		renderLink(<SpotifyReconnectLink />);

		// repairConnection's returned promise can genuinely reject — the
		// component has no local state to get stuck, but the click handler must
		// still catch it (never an unhandled rejection at the call site, per
		// 02-repair-action.md's contract).
		await user.click(
			screen.getByRole("link", { name: /reconnect to spotify/i }),
		);
		await vi.waitFor(() => expect(mockPairExtension).toHaveBeenCalledTimes(1));
	});
});
