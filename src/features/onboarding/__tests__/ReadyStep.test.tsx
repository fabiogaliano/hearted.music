import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@/test/utils/render";
import { ReadyStep } from "../components/ReadyStep";

const mockNavigate = vi.fn();
const mockSetQueryData = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockMarkOnboardingComplete = vi.fn();

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mockNavigate,
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		setQueryData: mockSetQueryData,
		invalidateQueries: mockInvalidateQueries,
	}),
}));

vi.mock("@/lib/keyboard/useShortcut", () => ({
	useShortcut: () => {},
}));

vi.mock("@/lib/server/onboarding.functions", () => ({
	markOnboardingComplete: (...args: unknown[]) =>
		mockMarkOnboardingComplete(...args),
}));

describe("ReadyStep", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockMarkOnboardingComplete.mockResolvedValue({ success: true });
		mockInvalidateQueries.mockResolvedValue(undefined);
		mockNavigate.mockResolvedValue(undefined);
	});

	it("marks onboarding complete, refreshes onboarding state, and goes to the dashboard", async () => {
		const { user } = render(
			<ReadyStep syncStats={{ songs: 15, playlists: 3 }} copyVariant="free" />,
		);

		await user.click(screen.getByRole("button", { name: /start exploring/i }));

		await waitFor(() => {
			expect(mockMarkOnboardingComplete).toHaveBeenCalledTimes(1);
		});

		expect(mockSetQueryData).toHaveBeenCalledWith(
			["auth", "onboarding"],
			expect.any(Function),
		);

		const updater = mockSetQueryData.mock.calls[0]?.[1] as
			| ((value: { isComplete: boolean; currentStep: string }) => unknown)
			| undefined;

		expect(updater).toBeDefined();
		expect(
			updater?.({
				isComplete: false,
				currentStep: "ready",
			}),
		).toMatchObject({
			isComplete: true,
			currentStep: "ready",
		});

		expect(mockInvalidateQueries).toHaveBeenCalledWith({
			queryKey: ["auth", "onboarding"],
		});

		await waitFor(() => {
			expect(mockNavigate).toHaveBeenCalledWith({ to: "/dashboard" });
		});
	});
});
