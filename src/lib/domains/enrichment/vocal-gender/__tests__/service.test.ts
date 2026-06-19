import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/domains/library/artists/queries", () => ({
	getUnresolvedGenderArtists: vi.fn(),
	applyGenderResolution: vi.fn(),
}));
vi.mock("@/lib/domains/library/songs/queries", () => ({
	refreshVocalGenderForSongs: vi.fn(),
}));
vi.mock("../local-lookup", () => ({ lookupLocalGenders: vi.fn() }));
vi.mock("../wikidata-fallback", () => ({ resolveWikidataGenders: vi.fn() }));
vi.mock("@/lib/observability/logger", () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
	applyGenderResolution,
	getUnresolvedGenderArtists,
} from "@/lib/domains/library/artists/queries";
import { refreshVocalGenderForSongs } from "@/lib/domains/library/songs/queries";
import { lookupLocalGenders } from "../local-lookup";
import { resolveVocalGenderForSongs } from "../service";
import { resolveWikidataGenders } from "../wikidata-fallback";

const mockUnresolved = vi.mocked(getUnresolvedGenderArtists);
const mockApply = vi.mocked(applyGenderResolution);
const mockRefresh = vi.mocked(refreshVocalGenderForSongs);
const mockLocal = vi.mocked(lookupLocalGenders);
const mockWiki = vi.mocked(resolveWikidataGenders);

const song = (id: string, artist_ids: string[]) => ({ id, artist_ids });

beforeEach(() => {
	vi.clearAllMocks();
	mockApply.mockResolvedValue(Result.ok(1));
	mockRefresh.mockResolvedValue(Result.ok(1));
	mockLocal.mockResolvedValue(new Map());
	mockWiki.mockResolvedValue([]);
});

describe("resolveVocalGenderForSongs", () => {
	it("does nothing when there are no artists", async () => {
		const stats = await resolveVocalGenderForSongs([]);
		expect(stats).toEqual({
			unresolvedArtists: 0,
			resolvedLocal: 0,
			resolvedWikidata: 0,
			songsRefreshed: 0,
		});
		expect(mockUnresolved).not.toHaveBeenCalled();
	});

	it("is a no-op when every artist is already resolved", async () => {
		mockUnresolved.mockResolvedValue(Result.ok([]));
		const stats = await resolveVocalGenderForSongs([song("s1", ["a1"])]);
		expect(stats.unresolvedArtists).toBe(0);
		expect(mockLocal).not.toHaveBeenCalled();
		expect(mockWiki).not.toHaveBeenCalled();
		expect(mockApply).not.toHaveBeenCalled();
		expect(mockRefresh).not.toHaveBeenCalled();
	});

	it("resolves locally and skips Wikidata when the dump covers every artist", async () => {
		mockUnresolved.mockResolvedValue(Result.ok(["a1"]));
		mockLocal.mockResolvedValue(new Map([["a1", "male"]]));

		const stats = await resolveVocalGenderForSongs([song("s1", ["a1"])]);

		expect(mockWiki).not.toHaveBeenCalled();
		expect(mockApply).toHaveBeenCalledWith([
			{
				spotify_id: "a1",
				gender: "male",
				band_gender: null,
				wikidata_id: null,
				wd_checked: false,
			},
		]);
		expect(mockRefresh).toHaveBeenCalledWith(["s1"]);
		expect(stats.resolvedLocal).toBe(1);
		expect(stats.resolvedWikidata).toBe(0);
	});

	it("falls back to Wikidata for dump misses and records band gender", async () => {
		mockUnresolved.mockResolvedValue(Result.ok(["band1"]));
		mockLocal.mockResolvedValue(new Map());
		mockWiki.mockResolvedValue([
			{
				spotify_id: "band1",
				gender: null,
				band_gender: "mixed",
				wikidata_id: "Q1",
			},
		]);

		const stats = await resolveVocalGenderForSongs([song("s1", ["band1"])]);

		expect(mockWiki).toHaveBeenCalledWith(["band1"]);
		expect(mockApply).toHaveBeenCalledWith([
			{
				spotify_id: "band1",
				gender: null,
				band_gender: "mixed",
				wikidata_id: "Q1",
				wd_checked: true,
			},
		]);
		expect(stats.resolvedWikidata).toBe(1);
	});

	it("stamps Wikidata-empty artists as checked without counting them resolved", async () => {
		mockUnresolved.mockResolvedValue(Result.ok(["ghost"]));
		mockWiki.mockResolvedValue([
			{
				spotify_id: "ghost",
				gender: null,
				band_gender: null,
				wikidata_id: null,
			},
		]);

		const stats = await resolveVocalGenderForSongs([song("s1", ["ghost"])]);

		// Recorded (so we don't re-query) but not counted as a resolution.
		expect(mockApply).toHaveBeenCalledWith([
			{
				spotify_id: "ghost",
				gender: null,
				band_gender: null,
				wikidata_id: null,
				wd_checked: true,
			},
		]);
		expect(stats.resolvedWikidata).toBe(0);
	});

	it("dedupes artists shared across songs", async () => {
		mockUnresolved.mockResolvedValue(Result.ok(["a1"]));
		mockLocal.mockResolvedValue(new Map([["a1", "female"]]));

		await resolveVocalGenderForSongs([song("s1", ["a1"]), song("s2", ["a1"])]);

		expect(mockUnresolved).toHaveBeenCalledWith(["a1"]);
		expect(mockRefresh).toHaveBeenCalledWith(["s1", "s2"]);
	});

	it("is best-effort: a query failure returns empty stats without throwing", async () => {
		mockUnresolved.mockResolvedValue(Result.err(new Error("db down") as never));
		const stats = await resolveVocalGenderForSongs([song("s1", ["a1"])]);
		expect(stats.songsRefreshed).toBe(0);
		expect(mockApply).not.toHaveBeenCalled();
	});

	it("is best-effort: an apply failure does not throw and skips refresh", async () => {
		mockUnresolved.mockResolvedValue(Result.ok(["a1"]));
		mockLocal.mockResolvedValue(new Map([["a1", "male"]]));
		mockApply.mockResolvedValue(Result.err(new Error("rpc failed") as never));

		const stats = await resolveVocalGenderForSongs([song("s1", ["a1"])]);
		expect(stats.songsRefreshed).toBe(0);
		expect(mockRefresh).not.toHaveBeenCalled();
	});
});
