import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredAnalysis } from "@/lib/domains/enrichment/content-analysis/read-schema";
import { likedSongsKeys } from "@/lib/query-keys";
import { getLikedSongAnalysis } from "@/lib/server/liked-songs.functions";
import { renderHook, waitFor } from "@/test/utils/render";
import { useLikedSongAnalysis } from "../hooks/useLikedSongAnalysis";
import type { LikedSong } from "../types";

/**
 * The detail panel's per-song analysis read, now that list rows don't carry
 * the analysis. Real QueryClient; only the server fn is mocked.
 */

vi.mock("@/lib/server/liked-songs.functions", () => ({
	getLikedSongAnalysis: vi.fn(),
}));

const ACCOUNT_ID = "acct-1";
const STORED: StoredAnalysis = { audioFeatures: null, read: null };
const WALKTHROUGH: StoredAnalysis = {
	audioFeatures: { tempo: 120, energy: 0.5, valence: 0.5 },
	read: null,
};
const NO_WALKTHROUGH = new Map<string, StoredAnalysis>();

function song(
	id: string,
	displayState: LikedSong["displayState"] = "analyzed",
): LikedSong {
	return {
		liked_at: "2026-03-30T00:00:00Z",
		matching_status: null,
		displayState,
		track: {
			id,
			spotify_track_id: `sp-${id}`,
			name: `Song ${id}`,
			artist: "Artist",
			artist_id: null,
			artist_image_url: null,
			album: null,
			image_url: null,
			genres: [],
			audio_features: null,
		},
	};
}

let queryClient: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
	<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
	vi.clearAllMocks();
	queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	vi.mocked(getLikedSongAnalysis).mockResolvedValue(STORED);
});

describe("useLikedSongAnalysis", () => {
	it("reads an analyzed song's analysis, showing loading until it lands", async () => {
		const { result } = renderHook(
			() => useLikedSongAnalysis(ACCOUNT_ID, song("a"), NO_WALKTHROUGH),
			{ wrapper },
		);

		expect(result.current).toEqual({ status: "loading" });
		await waitFor(() =>
			expect(result.current).toEqual({ status: "loaded", analysis: STORED }),
		);
		expect(getLikedSongAnalysis).toHaveBeenCalledWith({
			data: { songId: "a" },
		});
	});

	it.each([
		"locked",
		"pending",
		"failed",
	] as const)("never reads a %s song's analysis (none is stored or it isn't entitled)", (displayState) => {
		const { result } = renderHook(
			() =>
				useLikedSongAnalysis(
					ACCOUNT_ID,
					song("a", displayState),
					NO_WALKTHROUGH,
				),
			{ wrapper },
		);

		expect(result.current).toEqual({ status: "loaded", analysis: null });
		expect(getLikedSongAnalysis).not.toHaveBeenCalled();
	});

	it("uses a walkthrough song's bundled analysis without a read (the account may not have liked it)", () => {
		const { result } = renderHook(
			() =>
				useLikedSongAnalysis(
					ACCOUNT_ID,
					song("demo"),
					new Map([["demo", WALKTHROUGH]]),
				),
			{ wrapper },
		);

		expect(result.current).toEqual({
			status: "loaded",
			analysis: WALKTHROUGH,
		});
		expect(getLikedSongAnalysis).not.toHaveBeenCalled();
	});

	it("never shows a locked song a cached walkthrough analysis for the same catalog song", () => {
		const { result } = renderHook(
			() =>
				useLikedSongAnalysis(
					ACCOUNT_ID,
					song("demo", "locked"),
					new Map([["demo", WALKTHROUGH]]),
				),
			{ wrapper },
		);

		expect(result.current).toEqual({ status: "loaded", analysis: null });
	});

	it("re-reads an open panel's analysis when enrichment invalidates the liked-songs cache", async () => {
		const { result } = renderHook(
			() => useLikedSongAnalysis(ACCOUNT_ID, song("a"), NO_WALKTHROUGH),
			{ wrapper },
		);
		await waitFor(() => expect(result.current.status).toBe("loaded"));

		const regenerated: StoredAnalysis = {
			audioFeatures: { tempo: 90, energy: 0.2, valence: 0.9 },
			read: null,
		};
		vi.mocked(getLikedSongAnalysis).mockResolvedValue(regenerated);
		await queryClient.invalidateQueries({ queryKey: likedSongsKeys.all });

		await waitFor(() =>
			expect(result.current).toEqual({
				status: "loaded",
				analysis: regenerated,
			}),
		);
	});
});
