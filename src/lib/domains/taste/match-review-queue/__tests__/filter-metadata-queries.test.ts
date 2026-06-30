/**
 * Chunking behaviour for the filter-metadata query helpers.
 *
 * fetchSongsFilterMeta and fetchPlaylistsMatchFilters both feed snapshot-derived
 * id arrays into `.in()` filters. Left unbounded those overflow the PostgREST
 * URI-length limit on large libraries, so the ids are split into URL-safe
 * batches (DB_IN_FILTER_CHUNK_SIZE) and the rows merged back into the same Map
 * shape callers expect. These tests drive a capturing Supabase mock to assert
 * batch sizing, Map merging, empty-input behaviour, and error propagation.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";

const fromMock = vi.fn();

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: vi.fn(() => ({ from: fromMock })),
}));

import {
	fetchPlaylistsMatchFilters,
	fetchSongsFilterMeta,
} from "../filter-metadata-queries";

const ACCOUNT_ID = "acct-meta-1";

interface InCall {
	table: string;
	col: string;
	batch: string[];
}

type BatchResolver = (ctx: {
	table: string;
	col: string | null;
	batch: string[] | null;
}) => { data: unknown; error: unknown };

function installClient(resolver: BatchResolver): InCall[] {
	const inCalls: InCall[] = [];
	fromMock.mockImplementation((table: string) => {
		const ctx: { table: string; col: string | null; batch: string[] | null } = {
			table,
			col: null,
			batch: null,
		};
		const chain: Record<string, unknown> = {};
		const passthrough = () => chain;
		chain.select = vi.fn(passthrough);
		chain.eq = vi.fn(passthrough);
		chain.is = vi.fn(passthrough);
		chain.order = vi.fn(passthrough);
		chain.in = vi.fn((col: string, batch: string[]) => {
			ctx.col = col;
			ctx.batch = batch;
			inCalls.push({ table, col, batch });
			return chain;
		});
		// biome-ignore lint/suspicious/noThenProperty: the capturing mock chain is intentionally thenable so awaiting the query resolves to the per-batch response.
		chain.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
			Promise.resolve()
				.then(() => resolver(ctx))
				.then(onF, onR);
		return chain;
	});
	return inCalls;
}

describe("fetchSongsFilterMeta — chunking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromMock.mockReset();
	});

	it("returns an empty Map for empty input without touching the client", async () => {
		installClient(() => ({ data: [], error: null }));

		const result = await fetchSongsFilterMeta(ACCOUNT_ID, []);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.size).toBe(0);
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("chunks both the song and liked_song reads and merges into one Map", async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `song-${i}`);
		const inCalls = installClient((ctx) => {
			if (ctx.table === "song") {
				return {
					data: (ctx.batch ?? []).map((id) => ({
						id,
						language: "en",
						language_secondary: null,
						release_year: 2020,
						vocal_gender: null,
					})),
					error: null,
				};
			}
			// liked_song
			return {
				data: (ctx.batch ?? []).map((id) => ({
					song_id: id,
					liked_at: "2026-01-01T00:00:00.000Z",
				})),
				error: null,
			};
		});

		const result = await fetchSongsFilterMeta(ACCOUNT_ID, ids);

		expect(result).toBeOk();

		const songCalls = inCalls.filter((c) => c.table === "song");
		const likedCalls = inCalls.filter((c) => c.table === "liked_song");
		// 201 ids at chunk size 100 → 3 batches per table.
		expect(songCalls).toHaveLength(3);
		expect(likedCalls).toHaveLength(3);
		expect(songCalls.every((c) => c.col === "id")).toBe(true);
		expect(likedCalls.every((c) => c.col === "song_id")).toBe(true);
		expect(
			inCalls.every((c) => c.batch.length <= DB_IN_FILTER_CHUNK_SIZE),
		).toBe(true);

		if (Result.isOk(result)) {
			expect(result.value.size).toBe(201);
			const sample = result.value.get("song-150");
			expect(sample?.language).toBe("en");
			// liked_at merged in from the liked_song chunk.
			expect(sample?.likedAt).toBe(
				new Date("2026-01-01T00:00:00.000Z").getTime(),
			);
		}
	});

	it("propagates a song-batch DB error as Result.err", async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `song-${i}`);
		installClient((ctx) => {
			if (ctx.table === "song" && (ctx.batch ?? []).includes("song-150")) {
				return { data: null, error: { code: "PGRST301", message: "boom" } };
			}
			if (ctx.table === "song") {
				return {
					data: (ctx.batch ?? []).map((id) => ({
						id,
						language: null,
						language_secondary: null,
						release_year: null,
						vocal_gender: null,
					})),
					error: null,
				};
			}
			return { data: [], error: null };
		});

		const result = await fetchSongsFilterMeta(ACCOUNT_ID, ids);

		expect(result).toBeErr();
		if (Result.isError(result)) expect(result.error._tag).toBe("DatabaseError");
	});
});

describe("fetchPlaylistsMatchFilters — chunking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromMock.mockReset();
	});

	it("returns an empty Map for empty input without touching the client", async () => {
		installClient(() => ({ data: [], error: null }));

		const result = await fetchPlaylistsMatchFilters([]);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.size).toBe(0);
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("chunks the playlist read and merges into one Map", async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `pl-${i}`);
		const inCalls = installClient((ctx) => ({
			data: (ctx.batch ?? []).map((id) => ({ id, match_filters: null })),
			error: null,
		}));

		const result = await fetchPlaylistsMatchFilters(ids);

		expect(result).toBeOk();
		expect(inCalls).toHaveLength(3);
		expect(inCalls.every((c) => c.table === "playlist")).toBe(true);
		expect(inCalls.every((c) => c.col === "id")).toBe(true);
		expect(
			inCalls.every((c) => c.batch.length <= DB_IN_FILTER_CHUNK_SIZE),
		).toBe(true);

		if (Result.isOk(result)) {
			expect(result.value.size).toBe(201);
			// A null match_filters column maps to null (no filter).
			expect(result.value.get("pl-150")).toBeNull();
		}
	});

	it("propagates a batch DB error as Result.err", async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `pl-${i}`);
		installClient((ctx) => {
			if ((ctx.batch ?? []).includes("pl-150")) {
				return { data: null, error: { code: "PGRST301", message: "boom" } };
			}
			return { data: [], error: null };
		});

		const result = await fetchPlaylistsMatchFilters(ids);

		expect(result).toBeErr();
		if (Result.isError(result)) expect(result.error._tag).toBe("DatabaseError");
	});
});
