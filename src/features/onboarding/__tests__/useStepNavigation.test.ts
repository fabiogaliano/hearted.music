import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchQuery = vi.fn();
const mockNavigate = vi.fn();
const mockSaveOnboardingStep = vi.fn();
const mockGetOnboardingSession = vi.fn();

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({
		fetchQuery: mockFetchQuery,
	}),
}));

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({
		navigate: mockNavigate,
	}),
}));

vi.mock("@/lib/server/onboarding.functions", () => ({
	saveOnboardingStep: (...args: unknown[]) => mockSaveOnboardingStep(...args),
	getOnboardingSession: (...args: unknown[]) =>
		mockGetOnboardingSession(...args),
}));

// Use the real resolver
vi.mock("@/features/onboarding/step-resolver", async () => {
	const actual = await vi.importActual("@/features/onboarding/step-resolver");
	return actual;
});

import { useStepNavigation } from "../hooks/useStepNavigation";

const SAMPLE_SONG = {
	id: "song-uuid",
	spotifyTrackId: "spotify:track:abc",
	slug: "artist-name",
	name: "Name",
	artist: "Artist",
	artistId: null,
	artistImageUrl: null,
	album: null,
	albumArtUrl: null,
	genres: [],
	analysis: null,
};

describe("useStepNavigation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSaveOnboardingStep.mockResolvedValue({ success: true });
		mockNavigate.mockResolvedValue(undefined);
		mockFetchQuery.mockImplementation(async ({ queryFn }) => queryFn());
	});

	it("saves step, fetches fresh session, and navigates to /liked-songs for song-walkthrough", async () => {
		mockGetOnboardingSession.mockResolvedValue({
			session: { status: "song-walkthrough", song: SAMPLE_SONG },
			theme: null,
		});

		const { result } = renderHook(() => useStepNavigation());

		await act(() => result.current.navigateTo("song-walkthrough"));

		expect(mockSaveOnboardingStep).toHaveBeenCalledWith({
			data: { step: "song-walkthrough" },
		});
		expect(mockFetchQuery).toHaveBeenCalledWith(
			expect.objectContaining({ queryKey: ["auth", "onboarding-session"] }),
		);
		expect(mockNavigate).toHaveBeenCalledWith({ to: "/liked-songs" });
	});

	it("saves step, fetches fresh session, and navigates to /match for match-walkthrough", async () => {
		mockGetOnboardingSession.mockResolvedValue({
			session: { status: "match-walkthrough", song: SAMPLE_SONG },
			theme: null,
		});

		const { result } = renderHook(() => useStepNavigation());

		await act(() => result.current.navigateTo("match-walkthrough"));

		expect(mockSaveOnboardingStep).toHaveBeenCalledWith({
			data: { step: "match-walkthrough" },
		});
		expect(mockNavigate).toHaveBeenCalledWith({ to: "/match" });
	});

	it("saves step, fetches fresh session, and navigates to /playlists for flag-playlists", async () => {
		mockGetOnboardingSession.mockResolvedValue({
			session: { status: "flag-playlists" },
			theme: null,
		});

		const { result } = renderHook(() => useStepNavigation());

		await act(() => result.current.navigateTo("flag-playlists"));

		expect(mockSaveOnboardingStep).toHaveBeenCalledWith({
			data: { step: "flag-playlists" },
		});
		expect(mockNavigate).toHaveBeenCalledWith({ to: "/playlists" });
	});

	it("saves step and navigates to /onboarding?step= for plan-selection", async () => {
		mockGetOnboardingSession.mockResolvedValue({
			session: { status: "plan-selection" },
			theme: null,
		});

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

	it("fetches the session after saving the step, before navigating", async () => {
		const order: string[] = [];
		mockSaveOnboardingStep.mockImplementation(async () => {
			order.push("save");
			return { success: true };
		});
		mockGetOnboardingSession.mockImplementation(async () => {
			order.push("fetch");
			return {
				session: { status: "song-walkthrough", song: SAMPLE_SONG },
				theme: null,
			};
		});
		mockNavigate.mockImplementation(async () => {
			order.push("navigate");
		});

		const { result } = renderHook(() => useStepNavigation());
		await act(() => result.current.navigateTo("song-walkthrough"));

		expect(order).toEqual(["save", "fetch", "navigate"]);
	});

	it("shows error toast and does not navigate on save failure", async () => {
		mockSaveOnboardingStep.mockRejectedValue(new Error("Network error"));

		const { result } = renderHook(() => useStepNavigation());

		await act(() => result.current.navigateTo("song-walkthrough"));

		expect(mockNavigate).not.toHaveBeenCalled();
		expect(mockFetchQuery).not.toHaveBeenCalled();
	});
});
