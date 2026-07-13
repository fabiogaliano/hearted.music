/**
 * Tests for the studio's multi-artist selection server fns:
 * searchLikedArtists (query-filtered liked-artist aggregate) and
 * resolveLikedArtistSongs (filter-INDEPENDENT per-artist song-id resolution —
 * anchor-artist pins are filter-exempt, so their pool is the full liked catalog).
 *
 * getTopArtists and loadPhase1Candidates are mocked.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Phase1Candidate } from "@/lib/domains/playlists/candidate-loader";

const {
	mockAuthContext,
	mockGetTopArtists,
	mockSearchLikedArtistsByName,
	mockLoadPhase1Candidates,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-1" },
		account: null,
	},
	mockGetTopArtists: vi.fn(),
	mockSearchLikedArtistsByName: vi.fn(),
	mockLoadPhase1Candidates: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => {
	const builder = (): Record<string, unknown> => ({
		middleware: () => builder(),
		inputValidator: (validator: (data: unknown) => unknown) => ({
			handler:
				(
					fn: (args: {
						context: typeof mockAuthContext;
						data: unknown;
					}) => unknown,
				) =>
				(input?: { data?: unknown }) =>
					fn({ context: mockAuthContext, data: validator(input?.data) }),
		}),
		handler:
			(
				fn: (args: {
					context: typeof mockAuthContext;
					data: unknown;
				}) => unknown,
			) =>
			(input?: { data?: unknown }) =>
				fn({ context: mockAuthContext, data: input?.data }),
	});
	return {
		createServerFn: builder,
		createMiddleware: () => ({
			server: () => ({}),
			type: () => ({ server: () => ({}) }),
		}),
	};
});

vi.mock("@/lib/platform/auth/auth.middleware", () => ({ authMiddleware: {} }));

vi.mock("@/lib/domains/library/liked-songs/taste-profile-queries", () => ({
	getTopArtists: (...args: unknown[]) => mockGetTopArtists(...args),
	searchLikedArtistsByName: (...args: unknown[]) =>
		mockSearchLikedArtistsByName(...args),
	getLikedWindowAggregates: vi.fn(),
	getAccountReleaseYearAggregates: vi.fn(),
	rollUpDecades: vi.fn(),
}));

vi.mock("@/lib/domains/playlists/candidate-loader", () => ({
	loadPhase1Candidates: (...args: unknown[]) =>
		mockLoadPhase1Candidates(...args),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: vi.fn(),
}));

import {
	resolveLikedArtistSongs,
	searchLikedArtists,
} from "../playlists.functions";

function makeCandidate(
	id: string,
	artists: string[],
	releaseYear = 2020,
): Phase1Candidate {
	return {
		song: {
			id,
			spotifyId: `sp-${id}`,
			name: `Song ${id}`,
			artists,
			genres: ["pop"],
			audioFeatures: null,
		},
		filterMeta: {
			language: "en",
			languageSecondary: null,
			releaseYear,
			vocalGender: null,
			likedAt: Date.now(),
		},
		display: { imageUrl: null, album: null, durationMs: null },
	};
}

describe("searchLikedArtists", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns the ranked browse aggregate for an empty query without invoking search", async () => {
		mockGetTopArtists.mockResolvedValue(
			Result.ok([
				{ name: "KAYTRANADA", count: 26 },
				{ name: "Clairo", count: 19 },
			]),
		);

		const result = await searchLikedArtists({ data: { query: "" } });

		expect(result.artists).toEqual([
			{ name: "KAYTRANADA", count: 26 },
			{ name: "Clairo", count: 19 },
		]);
		expect(mockSearchLikedArtistsByName).not.toHaveBeenCalled();
	});

	it("routes a typed query through the full-population search, trimmed", async () => {
		mockSearchLikedArtistsByName.mockResolvedValue(
			Result.ok([{ name: "Clairo", count: 19 }]),
		);

		const result = await searchLikedArtists({ data: { query: "  cLaI " } });

		expect(mockSearchLikedArtistsByName).toHaveBeenCalledWith("acct-1", "cLaI");
		expect(result.artists).toEqual([{ name: "Clairo", count: 19 }]);
		expect(mockGetTopArtists).not.toHaveBeenCalled();
	});

	it("degrades to an empty list when the browse aggregate fails", async () => {
		mockGetTopArtists.mockResolvedValue(Result.err(new Error("boom")));

		const result = await searchLikedArtists({ data: { query: "" } });

		expect(result.artists).toEqual([]);
	});

	it("degrades to an empty list when the search query fails", async () => {
		mockSearchLikedArtistsByName.mockResolvedValue(
			Result.err(new Error("boom")),
		);

		const result = await searchLikedArtists({ data: { query: "x" } });

		expect(result.artists).toEqual([]);
	});
});

describe("resolveLikedArtistSongs", () => {
	beforeEach(() => vi.clearAllMocks());

	it("groups every liked candidate id per requested artist, in candidate (recency) order", async () => {
		mockLoadPhase1Candidates.mockResolvedValue([
			makeCandidate("s1", ["Clairo"]),
			makeCandidate("s2", ["KAYTRANADA"]),
			makeCandidate("s3", ["Clairo", "KAYTRANADA"]),
		]);

		const result = await resolveLikedArtistSongs({
			data: { artists: ["Clairo", "KAYTRANADA", "Nobody"] },
		});

		expect(result.artists).toEqual([
			{ name: "Clairo", songIds: ["s1", "s3"] },
			{ name: "KAYTRANADA", songIds: ["s2", "s3"] },
			{ name: "Nobody", songIds: [] },
		]);
	});

	it("is filter-INDEPENDENT: an anchor artist's pool is its full liked catalog", async () => {
		// An anchor artist is a filter-exempt pin, so resolution must ignore match
		// filters entirely — both the 1999 and 2021 songs stay in Clairo's pool
		// even though a release-year filter would otherwise drop the older one.
		mockLoadPhase1Candidates.mockResolvedValue([
			makeCandidate("old", ["Clairo"], 1999),
			makeCandidate("new", ["Clairo"], 2021),
		]);

		const result = await resolveLikedArtistSongs({
			data: { artists: ["Clairo"] },
		});

		expect(result.artists).toEqual([
			{ name: "Clairo", songIds: ["old", "new"] },
		]);
	});
});
