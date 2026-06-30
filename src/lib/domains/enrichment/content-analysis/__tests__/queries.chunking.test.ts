/**
 * Chunking behaviour for content-analysis get() (batch overload).
 *
 * The snapshot-refresh ranking stage loads analyses for the stored-pair song set
 * (getSongAnalyses → get(string[])), which can be song-sized. The helper must
 * split the `.in("song_id", …)` filter into URL-safe batches
 * (DB_IN_FILTER_CHUNK_SIZE) rather than encoding every id into one oversized
 * query string (the production "URI too long" failure). The single-id overload
 * stays a one-shot read. The capturing Supabase mock asserts batch shape, the
 * latest-per-song merge, the single-overload path, and error propagation.
 */

import { Result } from "better-result";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DB_IN_FILTER_CHUNK_SIZE } from "@/lib/shared/utils/chunked-write";

const fromMock = vi.fn();
const createClientMock = vi.fn(() => ({ from: fromMock }));

vi.mock("@/lib/data/client", () => ({
	createAdminSupabaseClient: () => createClientMock(),
}));

import { get } from "../queries";

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

function row(
	songId: string,
	createdAt: string,
	model: string,
): { song_id: string; created_at: string; model: string } {
	return { song_id: songId, created_at: createdAt, model };
}

describe("content-analysis get() — chunking", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		fromMock.mockReset();
	});

	it("returns an empty map for an empty batch without touching the client", async () => {
		installClient(() => ({ data: [], error: null }));

		const result = await get([]);

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value.size).toBe(0);
		expect(createClientMock).not.toHaveBeenCalled();
		expect(fromMock).not.toHaveBeenCalled();
	});

	it("splits a >100 id batch into multiple .in() batches each <= 100", async () => {
		const ids = Array.from({ length: 250 }, (_, i) => `song-${i}`);
		const inCalls = installClient((ctx) => ({
			data: (ctx.batch ?? []).map((id) => row(id, "2026-01-01T00:00:00Z", "m")),
			error: null,
		}));

		const result = await get(ids);

		expect(result).toBeOk();
		// 250 ids at chunk size 100 → 3 batches (100, 100, 50).
		expect(inCalls).toHaveLength(3);
		expect(inCalls.every((c) => c.table === "song_analysis")).toBe(true);
		expect(inCalls.every((c) => c.col === "song_id")).toBe(true);
		expect(
			inCalls.every((c) => c.batch.length <= DB_IN_FILTER_CHUNK_SIZE),
		).toBe(true);
		expect(inCalls.flatMap((c) => c.batch).sort()).toEqual([...ids].sort());
		if (Result.isOk(result)) expect(result.value.size).toBe(250);
	});

	it("keeps the latest-per-song analysis (created_at DESC first occurrence) after merge", async () => {
		const ids = ["song-A"];
		installClient(() => ({
			data: [
				row("song-A", "2026-06-01T00:00:00Z", "newest"),
				row("song-A", "2026-01-01T00:00:00Z", "oldest"),
			],
			error: null,
		}));

		const result = await get(ids);

		expect(result).toBeOk();
		if (Result.isOk(result)) {
			expect(result.value.get("song-A")?.model).toBe("newest");
		}
	});

	it("single-id overload issues one read and returns the row (not a map)", async () => {
		const inCalls = installClient((ctx) => ({
			data: (ctx.batch ?? []).map((id) => row(id, "2026-01-01T00:00:00Z", "m")),
			error: null,
		}));

		const result = await get("song-1");

		expect(result).toBeOk();
		expect(inCalls).toHaveLength(1);
		expect(inCalls[0].batch).toEqual(["song-1"]);
		if (Result.isOk(result)) {
			const value = result.value;
			// Narrow the single-id overload's union down to the row branch without a
			// cast: not null, not the batch Map, and carrying a song_id.
			expect(value).not.toBeNull();
			expect(value).not.toBeInstanceOf(Map);
			if (value !== null && !(value instanceof Map) && "song_id" in value) {
				expect(value.song_id).toBe("song-1");
			}
		}
	});

	it("single-id overload returns null when no row exists", async () => {
		installClient(() => ({ data: [], error: null }));

		const result = await get("missing");

		expect(result).toBeOk();
		if (Result.isOk(result)) expect(result.value).toBeNull();
	});

	it("propagates a batch DB error as a Result.err DbError", async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `song-${i}`);
		installClient((ctx) => {
			if ((ctx.batch ?? []).includes("song-150")) {
				return { data: null, error: { code: "PGRST301", message: "boom" } };
			}
			return { data: [], error: null };
		});

		const result = await get(ids);

		expect(result).toBeErr();
		if (Result.isError(result)) {
			expect(result.error._tag).toBe("DatabaseError");
		}
	});
});
