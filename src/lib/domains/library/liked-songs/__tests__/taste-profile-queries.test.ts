import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseYearAggregate } from "../filter-options-queries";

const mockRpc = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({ rpc: mockRpc })),
}));

const {
	getTopArtists,
	searchLikedArtistsByName,
	getLikedWindowAggregates,
	getAccountReleaseYearAggregates,
	rollUpDecades,
} = await import("../taste-profile-queries");

describe("getTopArtists", () => {
	beforeEach(() => vi.clearAllMocks());

	it("maps RPC rows to the domain shape and forwards the limit", async () => {
		mockRpc.mockResolvedValue({
			data: [
				{ artist: "KAYTRANADA", occurrences: 26 },
				{ artist: "Dua Lipa", occurrences: 19 },
			],
			error: null,
		});

		const result = await getTopArtists("acct-1", 8);

		expect(result).toEqual(
			Result.ok([
				{ name: "KAYTRANADA", count: 26 },
				{ name: "Dua Lipa", count: 19 },
			]),
		);
		expect(mockRpc).toHaveBeenCalledWith("get_account_top_artists", {
			p_account_id: "acct-1",
			p_limit: 8,
		});
	});

	it("defaults the limit to 12", async () => {
		mockRpc.mockResolvedValue({ data: [], error: null });

		await getTopArtists("acct-1");

		expect(mockRpc).toHaveBeenCalledWith("get_account_top_artists", {
			p_account_id: "acct-1",
			p_limit: 12,
		});
	});

	it("coerces bigint occurrences arriving as strings", async () => {
		mockRpc.mockResolvedValue({
			data: [{ artist: "SZA", occurrences: "14" }],
			error: null,
		});

		const result = await getTopArtists("acct-1");

		expect(result).toEqual(Result.ok([{ name: "SZA", count: 14 }]));
	});

	it("returns an empty array when the RPC yields null data", async () => {
		mockRpc.mockResolvedValue({ data: null, error: null });

		expect(await getTopArtists("acct-1")).toEqual(Result.ok([]));
	});

	it("returns a DatabaseError when the RPC fails", async () => {
		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "57014", message: "canceling statement" },
		});

		const result = await getTopArtists("acct-1");

		expect(Result.isError(result)).toBe(true);
	});
});

describe("searchLikedArtistsByName", () => {
	beforeEach(() => vi.clearAllMocks());

	it("maps RPC rows to the domain shape, forwarding the query and default limit", async () => {
		mockRpc.mockResolvedValue({
			data: [{ artist: "Clairo", occurrences: 19 }],
			error: null,
		});

		const result = await searchLikedArtistsByName("acct-1", "clai");

		expect(result).toEqual(Result.ok([{ name: "Clairo", count: 19 }]));
		expect(mockRpc).toHaveBeenCalledWith("search_account_liked_artists", {
			p_account_id: "acct-1",
			p_query: "clai",
			p_limit: 50,
		});
	});

	it("escapes ILIKE metacharacters so they match literally", async () => {
		mockRpc.mockResolvedValue({ data: [], error: null });

		await searchLikedArtistsByName("acct-1", "100% wet_leg\\");

		expect(mockRpc).toHaveBeenCalledWith("search_account_liked_artists", {
			p_account_id: "acct-1",
			p_query: "100\\% wet\\_leg\\\\",
			p_limit: 50,
		});
	});

	it("forwards a custom limit", async () => {
		mockRpc.mockResolvedValue({ data: [], error: null });

		await searchLikedArtistsByName("acct-1", "x", 8);

		expect(mockRpc).toHaveBeenCalledWith("search_account_liked_artists", {
			p_account_id: "acct-1",
			p_query: "x",
			p_limit: 8,
		});
	});

	it("coerces bigint occurrences arriving as strings", async () => {
		mockRpc.mockResolvedValue({
			data: [{ artist: "SZA", occurrences: "14" }],
			error: null,
		});

		expect(await searchLikedArtistsByName("acct-1", "sza")).toEqual(
			Result.ok([{ name: "SZA", count: 14 }]),
		);
	});

	it("returns an empty array when the RPC yields null data", async () => {
		mockRpc.mockResolvedValue({ data: null, error: null });

		expect(await searchLikedArtistsByName("acct-1", "x")).toEqual(
			Result.ok([]),
		);
	});

	it("returns a DatabaseError when the RPC fails", async () => {
		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "42883", message: "function does not exist" },
		});

		expect(Result.isError(await searchLikedArtistsByName("acct-1", "x"))).toBe(
			true,
		);
	});
});

describe("getLikedWindowAggregates", () => {
	beforeEach(() => vi.clearAllMocks());

	it("maps window rows to {id, count, from, to} and passes only the account id", async () => {
		mockRpc.mockResolvedValue({
			data: [
				{
					window_id: "last-30d",
					occurrences: 47,
					start_at: "2026-06-12T00:00:00Z",
					end_at: null,
				},
				{
					window_id: "first-3m",
					occurrences: 64,
					start_at: "2024-01-10T08:00:00Z",
					end_at: "2024-04-10T08:00:00Z",
				},
			],
			error: null,
		});

		const result = await getLikedWindowAggregates("acct-1");

		expect(result).toEqual(
			Result.ok([
				{
					id: "last-30d",
					count: 47,
					from: "2026-06-12T00:00:00Z",
					to: null,
				},
				{
					id: "first-3m",
					count: 64,
					from: "2024-01-10T08:00:00Z",
					to: "2024-04-10T08:00:00Z",
				},
			]),
		);
		expect(mockRpc).toHaveBeenCalledWith("get_account_liked_window_counts", {
			p_account_id: "acct-1",
		});
	});

	it("returns an empty array when the RPC yields null data", async () => {
		mockRpc.mockResolvedValue({ data: null, error: null });

		expect(await getLikedWindowAggregates("acct-1")).toEqual(Result.ok([]));
	});

	it("returns a DatabaseError when the RPC fails", async () => {
		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "42883", message: "function does not exist" },
		});

		expect(Result.isError(await getLikedWindowAggregates("acct-1"))).toBe(true);
	});
});

describe("getAccountReleaseYearAggregates", () => {
	beforeEach(() => vi.clearAllMocks());

	it("maps release-year count rows to min, max, and counts", async () => {
		mockRpc.mockResolvedValue({
			data: [
				{ release_year: 1999, occurrences: "2" },
				{ release_year: 2005, occurrences: 7 },
				{ release_year: 2020, occurrences: 3 },
			],
			error: null,
		});

		const result = await getAccountReleaseYearAggregates("acct-1");

		expect(result).toEqual(
			Result.ok({
				min: 1999,
				max: 2020,
				counts: [
					{ year: 1999, count: 2 },
					{ year: 2005, count: 7 },
					{ year: 2020, count: 3 },
				],
			}),
		);
		expect(mockRpc).toHaveBeenCalledWith("get_account_release_year_counts", {
			p_account_id: "acct-1",
		});
	});

	it("returns an empty aggregate when the RPC yields null data", async () => {
		mockRpc.mockResolvedValue({ data: null, error: null });

		expect(await getAccountReleaseYearAggregates("acct-1")).toEqual(
			Result.ok({ min: null, max: null, counts: [] }),
		);
	});

	it("returns a DatabaseError when the RPC fails", async () => {
		mockRpc.mockResolvedValue({
			data: null,
			error: { code: "57014", message: "canceling statement" },
		});

		expect(
			Result.isError(await getAccountReleaseYearAggregates("acct-1")),
		).toBe(true);
	});
});

describe("rollUpDecades", () => {
	function aggregate(
		counts: { year: number; count: number }[],
	): ReleaseYearAggregate {
		const years = counts.map((c) => c.year);
		return {
			min: years.length ? Math.min(...years) : null,
			max: years.length ? Math.max(...years) : null,
			counts,
		};
	}

	it("returns an empty list for an empty aggregate", () => {
		expect(rollUpDecades(aggregate([]))).toEqual([]);
	});

	it("groups years into decades and sums their counts", () => {
		const result = rollUpDecades(
			aggregate([
				{ year: 2011, count: 10 },
				{ year: 2015, count: 20 },
				{ year: 2019, count: 5 },
				{ year: 2003, count: 8 },
			]),
		);

		expect(result).toEqual([
			{ decadeStart: 2010, from: 2010, to: 2019, count: 35 },
			{ decadeStart: 2000, from: 2000, to: 2009, count: 8 },
		]);
	});

	it("clamps the open decade's upper bound to the newest liked year", () => {
		const result = rollUpDecades(
			aggregate([
				{ year: 2020, count: 3 },
				{ year: 2026, count: 12 },
			]),
		);

		expect(result).toEqual([
			{ decadeStart: 2020, from: 2020, to: 2026, count: 15 },
		]);
	});

	it("orders most-populous decade first, newest decade breaking ties", () => {
		const result = rollUpDecades(
			aggregate([
				{ year: 1995, count: 10 },
				{ year: 2005, count: 10 },
			]),
		);

		expect(result.map((d) => d.decadeStart)).toEqual([2000, 1990]);
	});
});
