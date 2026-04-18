import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockSetQueryData = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockNavigate = vi.fn();
const mockSaveOnboardingStep = vi.fn();

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		setQueryData: mockSetQueryData,
		invalidateQueries: mockInvalidateQueries,
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({
		navigate: mockNavigate,
	}),
}));

vi.mock("@/lib/server/onboarding.functions", () => ({
	saveOnboardingStep: (...args: unknown[]) => mockSaveOnboardingStep(...args),
}));

// Use the real resolver
vi.mock("@/features/onboarding/step-resolver", async () => {
	const actual = await vi.importActual("@/features/onboarding/step-resolver");
	return actual;
});

import { useStepNavigation } from "../hooks/useStepNavigation";

describe("useStepNavigation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSaveOnboardingStep.mockResolvedValue({ success: true });
		mockNavigate.mockResolvedValue(undefined);
	});

	it("saves step, syncs cache, and navigates to /liked-songs for song-walkthrough", async () => {
		const { result } = renderHook(() => useStepNavigation());

		await act(() => result.current.navigateTo("song-walkthrough"));

		expect(mockSaveOnboardingStep).toHaveBeenCalledWith({
			data: { step: "song-walkthrough" },
		});
		expect(mockSetQueryData).toHaveBeenCalledWith(
			["auth", "onboarding"],
			expect.any(Function),
		);
		expect(mockInvalidateQueries).toHaveBeenCalledWith({
			queryKey: ["auth", "onboarding"],
		});
		expect(mockNavigate).toHaveBeenCalledWith({ to: "/liked-songs" });
	});

	it("saves step, syncs cache, and navigates to /match for match-walkthrough", async () => {
		const { result } = renderHook(() => useStepNavigation());

		await act(() => result.current.navigateTo("match-walkthrough"));

		expect(mockSaveOnboardingStep).toHaveBeenCalledWith({
			data: { step: "match-walkthrough" },
		});
		expect(mockNavigate).toHaveBeenCalledWith({ to: "/match" });
	});

	it("saves step and navigates to /onboarding?step= for plan-selection", async () => {
		const { result } = renderHook(() => useStepNavigation());

		await act(() => result.current.navigateTo("plan-selection"));

		expect(mockSaveOnboardingStep).toHaveBeenCalledWith({
			data: { step: "plan-selection" },
		});
		expect(mockNavigate).toHaveBeenCalledWith({
			to: "/onboarding",
			search: { step: "plan-selection" },
		});
	});

	it("shows error toast and does not navigate on save failure", async () => {
		const mockToastError = vi.fn();
		vi.doMock("sonner", () => ({ toast: { error: mockToastError } }));

		mockSaveOnboardingStep.mockRejectedValue(new Error("Network error"));

		const { result } = renderHook(() => useStepNavigation());

		await act(() => result.current.navigateTo("song-walkthrough"));

		expect(mockNavigate).not.toHaveBeenCalled();
		expect(mockSetQueryData).not.toHaveBeenCalled();
	});

	it("updates cache with correct currentStep via updater function", async () => {
		const { result } = renderHook(() => useStepNavigation());

		await act(() => result.current.navigateTo("song-walkthrough"));

		const updater = mockSetQueryData.mock.calls[0][1] as (
			prev: { currentStep: string } | undefined,
		) => { currentStep: string } | undefined;

		expect(updater({ currentStep: "pick-demo-song" } as any)).toEqual({
			currentStep: "song-walkthrough",
		});

		expect(updater(undefined)).toBeUndefined();
	});
});
