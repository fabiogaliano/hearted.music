/**
 * Tests for the studio's multi-artist selection server fns:
 * searchLikedArtists (query-filtered liked-artist aggregate) and
 * resolveLikedArtistSongs (filter-INDEPENDENT per-artist song-id resolution —
 * anchor-artist pins are filter-exempt, so their pool is the full preview-eligible catalog).
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockAuthContext,
	mockGetTopArtists,
	mockSearchLikedArtistsByName,
	mockResolveLikedSongIdsByArtists,
	mockCaptureServerError,
} = vi.hoisted(() => ({
	mockAuthContext: {
		session: { accountId: "acct-1" },
		account: null,
	},
	mockGetTopArtists: vi.fn(),
	mockSearchLikedArtistsByName: vi.fn(),
	mockResolveLikedSongIdsByArtists: vi.fn(),
	mockCaptureServerError: vi.fn(),
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
	resolveLikedSongIdsByArtists: (...args: unknown[]) =>
		mockResolveLikedSongIdsByArtists(...args),
	getLikedWindowAggregates: vi.fn(),
	getAccountReleaseYearAggregates: vi.fn(),
	rollUpDecades: vi.fn(),
}));

vi.mock("@/lib/observability/capture-server-error", () => ({
	captureServerError: (...args: unknown[]) => mockCaptureServerError(...args),
}));

import {
	resolveLikedArtistSongs,
	searchLikedArtists,
} from "../playlists.functions";

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

	it("resolves the complete artist selection through one account-scoped query", async () => {
		mockResolveLikedSongIdsByArtists.mockResolvedValue(
			Result.ok([
				{ name: "Clairo", songIds: ["s1", "s3"] },
				{ name: "KAYTRANADA", songIds: ["s2", "s3"] },
				{ name: "Nobody", songIds: [] },
			]),
		);

		const artists = ["Clairo", "KAYTRANADA", "Nobody"];
		const result = await resolveLikedArtistSongs({ data: { artists } });

		expect(mockResolveLikedSongIdsByArtists).toHaveBeenCalledOnce();
		expect(mockResolveLikedSongIdsByArtists).toHaveBeenCalledWith(
			"acct-1",
			artists,
		);
		expect(result.artists).toEqual([
			{ name: "Clairo", songIds: ["s1", "s3"] },
			{ name: "KAYTRANADA", songIds: ["s2", "s3"] },
			{ name: "Nobody", songIds: [] },
		]);
	});

	it("captures query failures before throwing at the server boundary", async () => {
		const error = new Error("boom");
		mockResolveLikedSongIdsByArtists.mockResolvedValue(Result.err(error));

		await expect(
			resolveLikedArtistSongs({ data: { artists: ["Clairo"] } }),
		).rejects.toThrow("Failed to resolve liked artist songs");
		expect(mockCaptureServerError).toHaveBeenCalledWith(error, {
			area: "playlists",
			operation: "resolve_liked_artist_songs",
			accountId: "acct-1",
		});
	});
});
