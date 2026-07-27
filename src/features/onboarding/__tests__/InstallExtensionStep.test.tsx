import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SpotifyAccountStatus } from "@/lib/extension/detect";
import { setupOnboardingNavigationMock, setupShortcutMock } from "@/test/mocks";
import { act, fireEvent, render, screen, waitFor } from "@/test/utils/render";
import { InstallExtensionStep } from "../components/InstallExtensionStep";

const mockConnectExtension = vi.fn();
const mockIsExtensionInstalled = vi.fn();
const mockGetSpotifyAccountStatus = vi.fn();
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

function notConnectedStatus(
	overrides?: Partial<SpotifyAccountStatus>,
): SpotifyAccountStatus {
	return { connected: false, paired: null, profile: null, ...overrides };
}

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
// isExtensionInstalled/getSpotifyAccountStatus sit at the seam the shared
// connection query (useExtensionConnection) reads through — same seam
// connection-state.test.ts/useSpotifyGate.test.tsx mock, now that this
// component reads the shared verdict instead of its own detection poll.
vi.mock("@/lib/extension/detect", () => ({
	connectExtension: (...args: unknown[]) => mockConnectExtension(...args),
	expectLoginReturn: (armToken: string) => mockArmLoginReturn(armToken),
	isExtensionInstalled: () => mockIsExtensionInstalled(),
	getSpotifyAccountStatus: () => mockGetSpotifyAccountStatus(),
	triggerExtensionSync: () => mockTriggerExtensionSync(),
}));
vi.mock("@/components/ui/StaggeredContent", () => ({
	StaggeredContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../components/ExtensionSetupTrail", () => ({
	ExtensionSetupTrail: () => null,
}));

function withQueryClient(ui: ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>;
}

describe("InstallExtensionStep", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsExtensionInstalled.mockResolvedValue(true);
		mockGetSpotifyAccountStatus.mockResolvedValue(notConnectedStatus());
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

		render(withQueryClient(<InstallExtensionStep />));

		expect(await screen.findByText(/finish setting up/i)).toBeInTheDocument();
		// The install CTA must be gone — that dead-end is exactly what the gate fixes.
		expect(
			screen.queryByRole("link", { name: /log in to spotify/i }),
		).toBeNull();
		// Regression guard: the capability gate is checked before the
		// connection-consuming body mounts, so a device that can never finish
		// onboarding here never subscribes to the shared connection query and
		// never pings the extension — see InstallExtensionStep.tsx's comment on
		// why this must hold (an unbounded 6s poll on a phone otherwise).
		expect(mockIsExtensionInstalled).not.toHaveBeenCalled();
	});

	it("never polls the extension on a device that can't onboard here, even across multiple poll intervals", async () => {
		vi.useFakeTimers();
		mockUseOnboardingCapability.mockReturnValue({
			engine: "unsupported",
			engineSupported: false,
			wizardFits: false,
			canOnboardHere: false,
		});

		render(withQueryClient(<InstallExtensionStep />));

		// connection-state.ts's UNHEALTHY_REFETCH_INTERVAL_MS is 6s; advance well
		// past several ticks. A regression that mounts the connection-consuming
		// body before the capability check (or that widens the shared query with
		// a per-consumer `enabled` flag left mis-wired) would show up here as a
		// nonzero call count — the extension can structurally never answer on a
		// handheld, so `useExtensionConnection`'s verdict would sit permanently
		// at extension-missing and the shared query would ping forever.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(30_000);
		});

		expect(mockIsExtensionInstalled).not.toHaveBeenCalled();
		expect(mockGetSpotifyAccountStatus).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it("renders a stable login href and arms a tokenized continue destination on click", async () => {
		const randomUuid = vi
			.spyOn(globalThis.crypto, "randomUUID")
			.mockReturnValue("11111111-2222-3333-4444-555555555555");
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

		render(withQueryClient(<InstallExtensionStep />));

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
