/**
 * Tests for useCreatePlaylistFlow — the commit-flow lifecycle hook.
 *
 * The orchestrator (createPlaylistFromDraft / resumePlaylistCreateFromDraft)
 * is mocked so these are pure renderHook tests, no server/extension involved.
 *
 * The gate-failure isSubmitting-reset case is the regression test for the
 * stuck-CTA bug: previously CreateBar only reset isSubmitting on error/throw,
 * so a "reconnect-required"/"extension-unavailable" result left the CTA
 * permanently disabled even after the user recovered.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatePlaylistFromDraftInput } from "@/lib/extension/create-playlist-from-draft";

const createPlaylistFromDraftMock = vi.fn();
const resumePlaylistCreateFromDraftMock = vi.fn();

vi.mock("@/lib/extension/create-playlist-from-draft", () => ({
	createPlaylistFromDraft: (...args: unknown[]) =>
		createPlaylistFromDraftMock(...args),
	resumePlaylistCreateFromDraft: (...args: unknown[]) =>
		resumePlaylistCreateFromDraftMock(...args),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
		info: vi.fn(),
	},
}));

import { useCreatePlaylistFlow } from "../useCreatePlaylistFlow";

const INPUT_A: CreatePlaylistFromDraftInput = {
	name: "Night Mix",
	songIds: ["s1", "s2"],
	genrePills: ["indie"],
	matchFilters: { version: 1 },
	intentApplied: false,
	intent: null,
};

function setup() {
	const reportGateFailure = vi.fn();
	const { result } = renderHook(() =>
		useCreatePlaylistFlow({ reportGateFailure }),
	);
	return { result, reportGateFailure };
}

beforeEach(() => {
	createPlaylistFromDraftMock.mockReset();
	resumePlaylistCreateFromDraftMock.mockReset();
	vi.mocked(toast.error).mockClear();
});

describe("useCreatePlaylistFlow — submit → success", () => {
	it("attaches playlistName from the submitted input and resets isSubmitting", async () => {
		createPlaylistFromDraftMock.mockResolvedValueOnce({
			status: "success",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
			playlistId: "playlist-abc",
		});
		const { result } = setup();

		await act(async () => {
			await result.current.submit(INPUT_A);
		});

		expect(result.current.result).toEqual({
			status: "success",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
			playlistId: "playlist-abc",
			playlistName: "Night Mix",
		});
		expect(result.current.isSubmitting).toBe(false);
	});
});

describe("useCreatePlaylistFlow — submit → partial", () => {
	it("surfaces the partial result and resets isSubmitting", async () => {
		createPlaylistFromDraftMock.mockResolvedValueOnce({
			status: "partial",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
			playlistId: "playlist-abc",
			failedTrackCount: 2,
		});
		const { result } = setup();

		await act(async () => {
			await result.current.submit(INPUT_A);
		});

		expect(result.current.result).toEqual({
			status: "partial",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
			playlistId: "playlist-abc",
			failedTrackCount: 2,
		});
		expect(result.current.isSubmitting).toBe(false);
	});
});

describe("useCreatePlaylistFlow — submit → created-unsynced → retryUnsynced → success", () => {
	it("resumes and lands on success", async () => {
		createPlaylistFromDraftMock.mockResolvedValueOnce({
			status: "created-unsynced",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
		});
		resumePlaylistCreateFromDraftMock.mockResolvedValueOnce({
			status: "success",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
			playlistId: "playlist-abc",
		});
		const { result } = setup();

		await act(async () => {
			await result.current.submit(INPUT_A);
		});
		expect(result.current.result?.status).toBe("created-unsynced");

		await act(async () => {
			await result.current.retryUnsynced();
		});

		expect(result.current.result).toEqual({
			status: "success",
			playlistUri: "spotify:playlist:abc",
			spotifyId: "abc",
			playlistId: "playlist-abc",
			playlistName: "Night Mix",
		});
		expect(result.current.isRetryingUnsynced).toBe(false);
	});
});

describe("useCreatePlaylistFlow — resume uses the original input", () => {
	it("calls resumePlaylistCreateFromDraft with input A verbatim, unaffected by later reads", async () => {
		createPlaylistFromDraftMock.mockResolvedValueOnce({
			status: "created-unsynced",
			playlistUri: "spotify:playlist:xyz",
			spotifyId: "xyz",
		});
		resumePlaylistCreateFromDraftMock.mockResolvedValueOnce({
			status: "created-unsynced",
			playlistUri: "spotify:playlist:xyz",
			spotifyId: "xyz",
		});
		const { result } = setup();

		await act(async () => {
			await result.current.submit(INPUT_A);
		});

		await act(async () => {
			await result.current.retryUnsynced();
		});

		expect(resumePlaylistCreateFromDraftMock).toHaveBeenCalledWith(
			INPUT_A,
			"spotify:playlist:xyz",
			"xyz",
		);
	});
});

describe("useCreatePlaylistFlow — gate-failure routing (the stuck-CTA regression test)", () => {
	it.each([
		"reconnect-required",
		"extension-unavailable",
	] as const)("on %s: reports the gate failure, leaves result null, resets isSubmitting, and allows a second submit to reach the orchestrator", async (status) => {
		createPlaylistFromDraftMock.mockResolvedValueOnce({ status });
		const { result, reportGateFailure } = setup();

		await act(async () => {
			await result.current.submit(INPUT_A);
		});

		expect(reportGateFailure).toHaveBeenCalledWith(status);
		expect(result.current.result).toBeNull();
		// This is the bug: previously isSubmitting only reset on error/throw,
		// so the CTA stayed disabled forever after a gate failure.
		expect(result.current.isSubmitting).toBe(false);

		createPlaylistFromDraftMock.mockResolvedValueOnce({
			status: "success",
			playlistUri: "spotify:playlist:def",
			spotifyId: "def",
			playlistId: "playlist-def",
		});

		await act(async () => {
			await result.current.submit(INPUT_A);
		});

		expect(createPlaylistFromDraftMock).toHaveBeenCalledTimes(2);
		expect(result.current.result?.status).toBe("success");
	});
});

describe("useCreatePlaylistFlow — submit → error", () => {
	it("toasts the error message, leaves result null, and resets isSubmitting so it's retryable", async () => {
		createPlaylistFromDraftMock.mockResolvedValueOnce({
			status: "error",
			message: "Playlist creation failed",
		});
		const { result } = setup();

		await act(async () => {
			await result.current.submit(INPUT_A);
		});

		expect(toast.error).toHaveBeenCalledWith("Playlist creation failed");
		expect(result.current.result).toBeNull();
		expect(result.current.isSubmitting).toBe(false);
	});
});

describe("useCreatePlaylistFlow — submit throws", () => {
	it("toasts a generic message and resets isSubmitting so it's retryable", async () => {
		createPlaylistFromDraftMock.mockRejectedValueOnce(new Error("network"));
		const { result } = setup();

		await act(async () => {
			await result.current.submit(INPUT_A);
		});

		expect(toast.error).toHaveBeenCalledWith(
			"Something went sideways. Let's try that again.",
		);
		expect(result.current.result).toBeNull();
		expect(result.current.isSubmitting).toBe(false);

		// Retryable: a second submit reaches the orchestrator again.
		createPlaylistFromDraftMock.mockResolvedValueOnce({
			status: "success",
			playlistUri: "spotify:playlist:def",
			spotifyId: "def",
			playlistId: "playlist-def",
		});
		await act(async () => {
			await result.current.submit(INPUT_A);
		});
		await waitFor(() => expect(result.current.result?.status).toBe("success"));
	});
});
