import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";

// Each test controls the mock chain by pushing matchers on mockFrom.
const mockFrom = vi.fn();
vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => ({ from: mockFrom }),
}));

const { loadFilterMetadata } = await import("../filter-metadata-loader");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Supabase-shaped chain that returns rows on `.in()`. */
function makeChain(rows: unknown[]) {
	const chain = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		is: vi.fn().mockReturnThis(),
		in: vi.fn().mockResolvedValue({ data: rows, error: null }),
	};
	return chain;
}

/** Build a chain that returns a DB error on `.in()`. */
function makeErrorChain(message: string) {
	const chain = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		is: vi.fn().mockReturnThis(),
		in: vi.fn().mockResolvedValue({
			data: null,
			error: { code: "42P01", message },
		}),
	};
	return chain;
}

// ---------------------------------------------------------------------------
// Shape + keying
// ---------------------------------------------------------------------------

describe("loadFilterMetadata — shape and keying", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns empty maps for zero song ids", async () => {
		const result = await loadFilterMetadata("acc-1", []);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) return;
		expect(result.value.songMeta.size).toBe(0);
		expect(result.value.likedAtMs.size).toBe(0);
		// No DB calls should be made.
		expect(mockFrom).not.toHaveBeenCalled();
	});

	it("keys songMeta by song id and maps column names to camelCase", async () => {
		const songChain = makeChain([
			{
				id: "song-1",
				language: "pt",
				language_secondary: "en",
				release_year: 2020,
				vocal_gender: "female",
			},
		]);
		const likedChain = makeChain([]);

		// song query comes first (Promise.all), liked_song second
		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		const result = await loadFilterMetadata("acc-1", ["song-1"]);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) return;

		const meta = result.value.songMeta.get("song-1");
		expect(meta).toEqual({
			language: "pt",
			languageSecondary: "en",
			releaseYear: 2020,
			vocalGender: "female",
		});
	});

	it("keys likedAtMs by song id", async () => {
		const songChain = makeChain([
			{
				id: "song-1",
				language: null,
				language_secondary: null,
				release_year: null,
				vocal_gender: null,
			},
		]);
		const likedChain = makeChain([
			{ song_id: "song-1", liked_at: "2024-03-15T10:00:00.000Z" },
		]);

		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		const result = await loadFilterMetadata("acc-1", ["song-1"]);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) return;

		expect(result.value.likedAtMs.has("song-1")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Null / missing metadata
// ---------------------------------------------------------------------------

describe("loadFilterMetadata — null and missing metadata", () => {
	beforeEach(() => vi.clearAllMocks());

	it("stores null fields when the song row has nulls", async () => {
		const songChain = makeChain([
			{
				id: "song-null",
				language: null,
				language_secondary: null,
				release_year: null,
				vocal_gender: null,
			},
		]);
		const likedChain = makeChain([]);

		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		const result = await loadFilterMetadata("acc-1", ["song-null"]);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) return;

		expect(result.value.songMeta.get("song-null")).toEqual({
			language: null,
			languageSecondary: null,
			releaseYear: null,
			vocalGender: null,
		});
	});

	it("song with no liked row is absent from likedAtMs (maps to null for predicates)", async () => {
		const songChain = makeChain([
			{
				id: "song-unloved",
				language: "en",
				language_secondary: null,
				release_year: 2019,
				vocal_gender: null,
			},
		]);
		const likedChain = makeChain([]); // no liked row

		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		const result = await loadFilterMetadata("acc-1", ["song-unloved"]);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) return;

		// Absent from the map → caller uses ?? null → null for predicates.
		expect(result.value.likedAtMs.has("song-unloved")).toBe(false);
		expect(result.value.likedAtMs.get("song-unloved") ?? null).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Active-only liked filtering (unliked rows excluded)
// ---------------------------------------------------------------------------

describe("loadFilterMetadata — active-only liked filtering", () => {
	beforeEach(() => vi.clearAllMocks());

	it("queries liked_song with unliked_at IS NULL filter", async () => {
		const songChain = makeChain([]);
		const likedChain = makeChain([]);

		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		await loadFilterMetadata("acc-1", ["song-1"]);

		// Verify .is("unliked_at", null) was called on the liked_song chain.
		expect(likedChain.is).toHaveBeenCalledWith("unliked_at", null);
	});

	it("scopes the liked query to the given account id", async () => {
		const accountId = "acc-scope-test";
		const songChain = makeChain([]);
		const likedChain = makeChain([]);

		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		await loadFilterMetadata(accountId, ["song-1"]);

		// The liked_song query must be scoped to the account so it can never
		// return another account's liked rows.
		expect(likedChain.eq).toHaveBeenCalledWith("account_id", accountId);
	});

	it("does not include unliked songs in likedAtMs (only active rows in response)", async () => {
		const songChain = makeChain([
			{
				id: "song-unliked",
				language: null,
				language_secondary: null,
				release_year: null,
				vocal_gender: null,
			},
		]);
		// The DB enforces the filter; we simulate it by returning no rows for the unliked song.
		const likedChain = makeChain([]);

		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		const result = await loadFilterMetadata("acc-1", ["song-unliked"]);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) return;

		expect(result.value.likedAtMs.has("song-unliked")).toBe(false);
	});

	it("only includes the active liked row when a song has been re-liked (DB returns the active row)", async () => {
		const songChain = makeChain([
			{
				id: "song-reliked",
				language: null,
				language_secondary: null,
				release_year: null,
				vocal_gender: null,
			},
		]);
		// DB returns only the active row (unliked_at IS NULL in the real query).
		const activeTimestamp = "2025-01-10T08:00:00.000Z";
		const likedChain = makeChain([
			{ song_id: "song-reliked", liked_at: activeTimestamp },
		]);

		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		const result = await loadFilterMetadata("acc-1", ["song-reliked"]);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) return;

		const expectedMs = new Date(activeTimestamp).getTime();
		expect(result.value.likedAtMs.get("song-reliked")).toBe(expectedMs);
	});
});

// ---------------------------------------------------------------------------
// liked_at → epoch ms conversion
// ---------------------------------------------------------------------------

describe("loadFilterMetadata — liked_at timestamp to epoch ms conversion", () => {
	beforeEach(() => vi.clearAllMocks());

	it("converts ISO timestamp string to epoch milliseconds", async () => {
		const isoTimestamp = "2023-06-15T14:30:00.000Z";
		const expectedMs = new Date(isoTimestamp).getTime(); // 1686839400000

		const songChain = makeChain([
			{
				id: "song-ts",
				language: null,
				language_secondary: null,
				release_year: null,
				vocal_gender: null,
			},
		]);
		const likedChain = makeChain([
			{ song_id: "song-ts", liked_at: isoTimestamp },
		]);

		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		const result = await loadFilterMetadata("acc-1", ["song-ts"]);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) return;

		expect(result.value.likedAtMs.get("song-ts")).toBe(expectedMs);
		expect(typeof result.value.likedAtMs.get("song-ts")).toBe("number");
	});

	it("converts multiple songs' liked_at values independently", async () => {
		const ts1 = "2022-01-01T00:00:00.000Z";
		const ts2 = "2024-12-31T23:59:59.999Z";

		const songChain = makeChain([
			{
				id: "s1",
				language: null,
				language_secondary: null,
				release_year: null,
				vocal_gender: null,
			},
			{
				id: "s2",
				language: null,
				language_secondary: null,
				release_year: null,
				vocal_gender: null,
			},
		]);
		const likedChain = makeChain([
			{ song_id: "s1", liked_at: ts1 },
			{ song_id: "s2", liked_at: ts2 },
		]);

		mockFrom.mockReturnValueOnce(songChain).mockReturnValueOnce(likedChain);

		const result = await loadFilterMetadata("acc-1", ["s1", "s2"]);
		expect(Result.isOk(result)).toBe(true);
		if (Result.isError(result)) return;

		expect(result.value.likedAtMs.get("s1")).toBe(new Date(ts1).getTime());
		expect(result.value.likedAtMs.get("s2")).toBe(new Date(ts2).getTime());
	});
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("loadFilterMetadata — error handling", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns Result.err on song query failure", async () => {
		const songErrorChain = makeErrorChain("song table unavailable");
		const likedChain = makeChain([]);

		mockFrom
			.mockReturnValueOnce(songErrorChain)
			.mockReturnValueOnce(likedChain);

		const result = await loadFilterMetadata("acc-1", ["song-1"]);
		expect(Result.isError(result)).toBe(true);
	});

	it("returns Result.err on liked_song query failure", async () => {
		const songChain = makeChain([]);
		const likedErrorChain = makeErrorChain("liked_song table unavailable");

		mockFrom
			.mockReturnValueOnce(songChain)
			.mockReturnValueOnce(likedErrorChain);

		const result = await loadFilterMetadata("acc-1", ["song-1"]);
		expect(Result.isError(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Chunking — ids exceeding DB_IN_FILTER_CHUNK_SIZE are split into batches
// ---------------------------------------------------------------------------

describe("loadFilterMetadata — chunking", () => {
	beforeEach(() => vi.clearAllMocks());

	it("issues multiple batches when song id count exceeds chunk size", async () => {
		// 150 ids spans two chunks of 100 + 50 for both song and liked_song queries.
		const songCount = DB_IN_FILTER_CHUNK_SIZE + 50;
		const songIds = Array.from({ length: songCount }, (_, i) => `song-${i}`);

		// Each from() call needs its own chain; 2 song batches + 2 liked batches = 4.
		mockFrom.mockReturnValue(makeChain([]));

		await loadFilterMetadata("acc-1", songIds);

		// Both song and liked_song split into 2 batches → 4 from() calls total.
		expect(mockFrom).toHaveBeenCalledTimes(4);
	});
});
