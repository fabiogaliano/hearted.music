import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupOnboardingNavigationMock, setupShortcutMock } from "@/test/mocks";
import { fireEvent, render, screen, waitFor } from "@/test/utils/render";
import { InstallExtensionStep } from "../components/InstallExtensionStep";

const mockConnectExtension = vi.fn();
const mockGetSpotifyConnectionStatus = vi.fn();
const mockIsExtensionInstalled = vi.fn();
const mockTriggerExtensionSync = vi.fn();
const mockResetSyncJobs = vi.fn();
const mockArmLoginReturn = vi.fn();
const mockUseOnboardingCapability = vi.fn();

const CAPABLE = {
	engine: "chromium" as const,
	engineSupported: true,
	wizardFits: true,
	canOnboardHere: true,
};

vi.mock("@/lib/keyboard/useShortcut", () => setupShortcutMock());
vi.mock("../hooks/useOnboardingNavigation", () =>
	setupOnboardingNavigationMock(),
);
// The install flow assumes a capable device; jsdom's UA reads as unsupported, so
// without this the gate would render the handoff. Tests that care about the gate
// override the return value.
vi.mock("../hooks/useOnboardingCapability", () => ({
	useOnboardingCapability: () => mockUseOnboardingCapability(),
}));
vi.mock("@/lib/server/onboarding.functions", () => ({
	resetSyncJobs: () => mockResetSyncJobs(),
}));
vi.mock("@/lib/extension/detect", () => ({
	connectExtension: (...args: unknown[]) => mockConnectExtension(...args),
	expectLoginReturn: (armToken: string) => mockArmLoginReturn(armToken),
	getSpotifyConnectionStatus: () => mockGetSpotifyConnectionStatus(),
	isExtensionInstalled: () => mockIsExtensionInstalled(),
	triggerExtensionSync: () => mockTriggerExtensionSync(),
}));
vi.mock("@/components/ui/StaggeredContent", () => ({
	StaggeredContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../components/ExtensionSetupTrail", () => ({
	ExtensionSetupTrail: () => null,
}));

describe("InstallExtensionStep", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyConnectionStatus.mockResolvedValue(false);
		mockArmLoginReturn.mockResolvedValue(true);
		mockUseOnboardingCapability.mockReturnValue(CAPABLE);
	});

	it("renders the finish-on-a-computer handoff when the device can't onboard here", async () => {
		mockUseOnboardingCapability.mockReturnValue({
			engine: "unsupported",
			engineSupported: false,
			wizardFits: false,
			canOnboardHere: false,
		});

		render(<InstallExtensionStep />);

		expect(await screen.findByText(/finish setting up/i)).toBeInTheDocument();
		// The install CTA must be gone — that dead-end is exactly what the gate fixes.
		expect(
			screen.queryByRole("link", { name: /log in to spotify/i }),
		).toBeNull();
		expect(mockIsExtensionInstalled).not.toHaveBeenCalled();
	});

	it("renders a stable login href and arms a tokenized continue destination on click", async () => {
		const randomUuid = vi
			.spyOn(globalThis.crypto, "randomUUID")
			.mockReturnValue("11111111-2222-3333-4444-555555555555");
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

		render(<InstallExtensionStep />);

		const loginLink = await screen.findByRole("link", {
			name: /log in to spotify/i,
		});
		const href = loginLink.getAttribute("href") ?? "";
		const url = new URL(href);

		expect(url.origin + url.pathname).toBe(
			"https://accounts.spotify.com/en-GB/login",
		);
		expect(url.searchParams.get("continue")).toBe("https://open.spotify.com/");
		expect(url.hash).toBe("");

		fireEvent.click(loginLink);

		await waitFor(() => {
			expect(mockArmLoginReturn).toHaveBeenCalledWith(
				"11111111-2222-3333-4444-555555555555",
			);
		});

		const openedUrl = new URL(openSpy.mock.calls[0]?.[0] as string);
		expect(openedUrl.origin + openedUrl.pathname).toBe(
			"https://accounts.spotify.com/en-GB/login",
		);
		const continueUrl = new URL(openedUrl.searchParams.get("continue") ?? "");
		expect(continueUrl.origin + continueUrl.pathname).toBe(
			"https://open.spotify.com/",
		);
		expect(
			new URLSearchParams(continueUrl.hash.replace(/^#/, "")).get(
				"hearted-arm",
			),
		).toBe("11111111-2222-3333-4444-555555555555");

		randomUuid.mockRestore();
		openSpy.mockRestore();
	});
});
