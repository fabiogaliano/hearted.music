/**
 * Tests for useCreatePlaylistDraft — currently just the "Refresh suggestions"
 * paging seam, which had no coverage before.
 *
 * previewPlaylistDraft is mocked so the hook is exercised without a server;
 * the assertion reads the suggestionsOffset each call was made with, which is
 * the hook's only observable trace of its internal paging state.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUGGESTIONS_COUNT } from "@/lib/domains/playlists/constants";
import type { PreviewPlaylistDraftResult } from "@/lib/server/playlist-draft.functions";

const previewPlaylistDraftMock = vi.fn();

vi.mock("@/lib/server/playlist-draft.functions", () => ({
	previewPlaylistDraft: (...args: unknown[]) =>
		previewPlaylistDraftMock(...args),
}));

import { useCreatePlaylistDraft } from "../useCreatePlaylistDraft";

const EMPTY_RESULT: PreviewPlaylistDraftResult = {
	preview: [],
	suggestions: [],
	totalEligible: 0,
	intentApplied: false,
};

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
	);
}

describe("useCreatePlaylistDraft — refreshSuggestions paging", () => {
	beforeEach(() => {
		previewPlaylistDraftMock.mockReset();
		previewPlaylistDraftMock.mockResolvedValue(EMPTY_RESULT);
		queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
	});

	it("advances suggestionsOffset by exactly SUGGESTIONS_COUNT per call", async () => {
		const { result } = renderHook(() => useCreatePlaylistDraft(), {
			wrapper,
		});

		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(previewPlaylistDraftMock).toHaveBeenLastCalledWith({
			data: expect.objectContaining({ suggestionsOffset: 0 }),
		});

		act(() => {
			result.current.refreshSuggestions();
		});
		await waitFor(() =>
			expect(previewPlaylistDraftMock).toHaveBeenLastCalledWith({
				data: expect.objectContaining({ suggestionsOffset: SUGGESTIONS_COUNT }),
			}),
		);

		act(() => {
			result.current.refreshSuggestions();
		});
		await waitFor(() =>
			expect(previewPlaylistDraftMock).toHaveBeenLastCalledWith({
				data: expect.objectContaining({
					suggestionsOffset: 2 * SUGGESTIONS_COUNT,
				}),
			}),
		);
	});
});
